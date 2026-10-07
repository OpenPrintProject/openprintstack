// SPDX-FileCopyrightText: 2026 Open Print Stack contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { BOOT_ID, USER_ID } from "@openprintstack/protocol/fixtures";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen } from "@testing-library/react";
import { type ReactNode, StrictMode, useState } from "react";
import { describe, expect, it, onTestFinished, vi } from "vitest";

import {
  type FakeWebSocket,
  FakeSockets,
  eventOf,
  printerSnapshot,
} from "../test/fake-socket.ts";
import {
  RealtimeProvider,
  useConnectionStatus,
  useFleet,
  usePrinter,
  useRealtime,
  useRealtimeEvents,
} from "./provider.tsx";

const OTHER_BOOT = "0199b3a0-1c00-7000-8000-00000000b002";

function setup(ui: ReactNode, options: { strict?: boolean } = {}) {
  const sockets = new FakeSockets();
  const queryClient = new QueryClient();
  const signedOut = vi.fn();
  const tree = (
    <QueryClientProvider client={queryClient}>
      <RealtimeProvider
        settings={{
          url: "ws://localhost:5173/api/ws",
          createSocket: sockets.create,
          checkSession: () => Promise.resolve("active"),
          onSignedOut: signedOut,
          queryClient,
          random: () => 0,
        }}
      >
        {ui}
      </RealtimeProvider>
    </QueryClientProvider>
  );
  const view = render(
    options.strict === true ? <StrictMode>{tree}</StrictMode> : tree,
  );
  return { sockets, queryClient, signedOut, view };
}

/**
 * Runs `send` as the server, then waits a task: the Query cache tells React
 * about changes in a setTimeout.
 */
async function server(send: () => void): Promise<void> {
  await act(async () => {
    send();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

/** Accepts the socket and sends hello, as the server does. */
async function connect(
  socket: FakeWebSocket,
  bootId: string = BOOT_ID,
): Promise<void> {
  await server(() => {
    socket.accept();
    socket.receive({
      type: "hello",
      bootId,
      user: { id: USER_ID, username: "rob" },
    });
  });
}

function Status() {
  return <p>Status: {useConnectionStatus()}</p>;
}

function Fleet() {
  const fleet = useFleet();
  if (fleet === undefined) return <p>Loading the fleet</p>;
  return (
    <ul aria-label="fleet">
      {fleet.map(({ printer, state }) => (
        <li key={printer.id}>
          {printer.name}: {state.status}
        </li>
      ))}
    </ul>
  );
}

function Printer({ id }: { id: string }) {
  const printer = usePrinter(id);
  if (printer === undefined) return <p>Loading {id}</p>;
  if (printer === null) return <p>No printer {id}</p>;
  return (
    <p>
      {printer.printer.name}: {printer.state.status}
    </p>
  );
}

/** Shows `children` until the button is pressed. */
function Toggle({ children }: { children: ReactNode }) {
  const [shown, setShown] = useState(true);
  return (
    <>
      <button
        onClick={() => {
          setShown(!shown);
        }}
      >
        Toggle
      </button>
      {shown && children}
    </>
  );
}

function fleetItems(): string[] {
  return screen.getAllByRole("listitem").map((item) => item.textContent);
}

describe("RealtimeProvider", () => {
  it("connects when it mounts and closes the socket when it unmounts", async () => {
    const { sockets, view } = setup(<Status />);

    expect(screen.getByText("Status: connecting")).toBeDefined();
    await connect(sockets.last);
    expect(screen.getByText("Status: live")).toBeDefined();

    view.unmount();

    expect(sockets.last.closedWith).toEqual({
      code: 1000,
      reason: "The page closed the connection.",
    });
  });

  it("ends up with one live socket and one subscription under StrictMode", async () => {
    const { sockets } = setup(<Fleet />, { strict: true });

    await connect(sockets.last);
    await act(async () => {});

    expect(
      sockets.all
        .slice(0, -1)
        .every((socket) => socket.closedWith?.code === 1000),
    ).toBe(true);
    expect(sockets.last.sent).toEqual([
      { type: "subscribe", topic: { name: "fleet" } },
    ]);
  });

  it("refuses hooks outside it", () => {
    function Outside() {
      useRealtime();
      return null;
    }
    // React logs the error it rethrows.
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    onTestFinished(() => {
      logged.mockRestore();
    });

    expect(() => render(<Outside />)).toThrow(
      "useRealtime needs a <RealtimeProvider> above it.",
    );
  });
});

describe("useFleet", () => {
  it("is undefined until the snapshot, then lists the printers by name", async () => {
    const { sockets } = setup(<Fleet />);
    await connect(sockets.last);

    expect(screen.getByText("Loading the fleet")).toBeDefined();
    await server(() => {
      sockets.last.receive({
        type: "snapshot",
        topic: { name: "fleet" },
        seq: 20,
        data: [
          printerSnapshot("p10", "Printer 10", { status: "idle" }),
          printerSnapshot("p2", "printer 2", { status: "printing" }),
          printerSnapshot("pa", "Annex", { status: "offline" }),
        ],
      });
    });

    expect(fleetItems()).toEqual([
      "Annex: offline",
      "printer 2: printing",
      "Printer 10: idle",
    ]);
  });

  it("follows the fleet's events", async () => {
    const { sockets } = setup(<Fleet />);
    await connect(sockets.last);
    await server(() => {
      sockets.last.receive({
        type: "snapshot",
        topic: { name: "fleet" },
        seq: 20,
        data: [
          printerSnapshot("printer-1", "Sim 1", { status: "idle", seq: 20 }),
        ],
      });
    });

    await server(() => {
      sockets.last.receive({
        type: "event",
        topic: { name: "fleet" },
        event: eventOf("printer.status_changed", 21),
      });
      sockets.last.receive({
        type: "event",
        topic: { name: "fleet" },
        event: eventOf("printer.added", 22, {
          printerId: "printer-2",
          payload: { name: "A new one", driverType: "simulated" },
        }),
      });
    });

    expect(fleetItems()).toEqual(["A new one: connecting", "Sim 1: error"]);
  });

  it("shares one subscription between components, and keeps it while one still uses it", async () => {
    const { sockets } = setup(
      <>
        <Fleet />
        <Toggle>
          <Fleet />
        </Toggle>
      </>,
    );
    await connect(sockets.last);

    act(() => {
      screen.getByText("Toggle").click();
    });
    await act(async () => {});
    expect(sockets.last.sent).toEqual([
      { type: "subscribe", topic: { name: "fleet" } },
    ]);
  });

  it("unsubscribes once no component uses it, and forgets its data", async () => {
    const { sockets, queryClient } = setup(
      <Toggle>
        <Fleet />
      </Toggle>,
    );
    await connect(sockets.last);
    await server(() => {
      sockets.last.receive({
        type: "snapshot",
        topic: { name: "fleet" },
        seq: 20,
        data: [],
      });
    });

    act(() => {
      screen.getByText("Toggle").click();
    });
    await act(async () => {});

    expect(sockets.last.sent).toEqual([
      { type: "subscribe", topic: { name: "fleet" } },
      { type: "unsubscribe", topic: { name: "fleet" } },
    ]);
    expect(queryClient.getQueryData(["realtime", "fleet"])).toBeUndefined();
  });

  it("empties on a server restart and fills again from the new snapshot", async () => {
    const { sockets } = setup(<Fleet />);
    await connect(sockets.last);
    await server(() => {
      sockets.last.receive({
        type: "snapshot",
        topic: { name: "fleet" },
        seq: 20,
        data: [printerSnapshot("printer-1", "Sim 1", { status: "printing" })],
      });
    });

    await server(() => {
      sockets.last.drop();
    });
    // The first reconnect waits 0.25 s.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 300));
    });
    await connect(sockets.last, OTHER_BOOT);

    expect(screen.getByText("Loading the fleet")).toBeDefined();
    await server(() => {
      sockets.last.receive({
        type: "snapshot",
        topic: { name: "fleet" },
        seq: 2,
        data: [
          printerSnapshot("printer-1", "Sim 1", {
            status: "connecting",
            seq: 2,
          }),
        ],
      });
    });
    expect(fleetItems()).toEqual(["Sim 1: connecting"]);
  });
});

describe("usePrinter", () => {
  it("subscribes the printer, and shows null for one the server doesn't have", async () => {
    const { sockets } = setup(
      <>
        <Printer id="printer-1" />
        <Printer id="printer-9" />
      </>,
    );
    await connect(sockets.last);

    await server(() => {
      sockets.last.receive({
        type: "snapshot",
        topic: { name: "printer", printerId: "printer-1" },
        seq: 20,
        data: printerSnapshot("printer-1", "Sim 1", { status: "idle" }),
      });
      sockets.last.receive({
        type: "error",
        code: "printer_not_found",
        message: "There is no printer printer-9.",
        topic: { name: "printer", printerId: "printer-9" },
      });
    });

    expect(sockets.last.topics()).toEqual([
      JSON.stringify({ name: "printer", printerId: "printer-1" }),
      JSON.stringify({ name: "printer", printerId: "printer-9" }),
    ]);
    expect(screen.getByText("Sim 1: idle")).toBeDefined();
    expect(screen.getByText("No printer printer-9")).toBeDefined();
  });

  it("keeps its subscription across renders, and moves it when the id changes", async () => {
    function Switcher() {
      const [id, setId] = useState("printer-1");
      const [renders, setRenders] = useState(0);
      return (
        <>
          <button
            onClick={() => {
              setRenders(renders + 1);
            }}
          >
            Render again
          </button>
          <button
            onClick={() => {
              setId("printer-2");
            }}
          >
            Next
          </button>
          <Printer id={id} />
        </>
      );
    }
    const { sockets } = setup(<Switcher />);
    await connect(sockets.last);

    act(() => {
      screen.getByText("Render again").click();
    });
    await act(async () => {});
    expect(sockets.last.sent).toHaveLength(1);
    act(() => {
      screen.getByText("Next").click();
    });
    await act(async () => {});

    expect(sockets.last.sent).toEqual([
      { type: "subscribe", topic: { name: "printer", printerId: "printer-1" } },
      { type: "subscribe", topic: { name: "printer", printerId: "printer-2" } },
      {
        type: "unsubscribe",
        topic: { name: "printer", printerId: "printer-1" },
      },
    ]);
  });
});

describe("useRealtimeEvents", () => {
  function Listener({ heard }: { heard: string[] }) {
    useFleet();
    useRealtimeEvents((event) => {
      heard.push(`${event.type} ${event.seq}`);
    });
    return null;
  }

  it("hears live events, not the snapshot, and nothing once unmounted", async () => {
    const heard: string[] = [];
    const { sockets, view } = setup(<Listener heard={heard} />);
    await connect(sockets.last);
    const fleet = { name: "fleet" } as const;
    await server(() => {
      sockets.last.receive({
        type: "snapshot",
        topic: fleet,
        seq: 42,
        data: [printerSnapshot("printer-1", "Sim 1", { status: "error" })],
      });
      sockets.last.receive({
        type: "event",
        topic: fleet,
        event: eventOf("printer.alert", 43),
      });
    });

    view.unmount();
    expect(heard).toEqual(["printer.alert 43"]);
  });

  it("uses the latest listener without subscribing again", async () => {
    const heard: string[] = [];
    function Changing() {
      const [label, setLabel] = useState("first");
      useFleet();
      useRealtimeEvents((event) => {
        heard.push(`${label} ${event.seq}`);
        setLabel("second");
      });
      return null;
    }
    const { sockets } = setup(<Changing />);
    await connect(sockets.last);
    const fleet = { name: "fleet" } as const;
    await server(() => {
      sockets.last.receive({
        type: "snapshot",
        topic: fleet,
        seq: 42,
        data: [printerSnapshot("printer-1", "Sim 1")],
      });
    });

    for (const seq of [43, 44]) {
      await server(() => {
        sockets.last.receive({
          type: "event",
          topic: fleet,
          event: eventOf("printer.alert", seq),
        });
      });
    }

    expect(heard).toEqual(["first 43", "second 44"]);
    expect(
      sockets.last.sent.filter((message) => message.type === "subscribe"),
    ).toHaveLength(1);
  });
});
