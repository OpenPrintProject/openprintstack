// SPDX-FileCopyrightText: 2026 Open Print Stack contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { OpsEvent, Topic } from "@openprintstack/protocol";
import { BOOT_ID, USER_ID } from "@openprintstack/protocol/fixtures";
import { describe, expect, it, onTestFinished, vi } from "vitest";

import {
  type FakeWebSocket,
  FakeSockets,
  eventOf,
  printerSnapshot,
} from "../test/fake-socket.ts";
import {
  type RealtimeSink,
  RealtimeClient,
  type SessionCheck,
  type SnapshotMessage,
} from "./client.ts";

const URL = "ws://localhost:5173/api/ws";
const OTHER_BOOT = "0199b3a0-1c00-7000-8000-00000000b002";
const FLEET = { name: "fleet" } as const satisfies Topic;
const PRINTER = {
  name: "printer",
  printerId: "printer-1",
} as const satisfies Topic;

/** Records what the client hands it, as short strings. */
class RecordingSink implements RealtimeSink {
  readonly calls: string[] = [];
  answer: "applied" | "resync" = "applied";

  snapshot(message: SnapshotMessage): void {
    this.calls.push(`snapshot ${message.topic.name} ${message.seq}`);
  }

  event(topic: Topic, event: OpsEvent): "applied" | "resync" {
    this.calls.push(`event ${topic.name} ${event.seq}`);
    return this.answer;
  }

  refused(topic: Topic, code: string): void {
    this.calls.push(`refused ${topic.name} ${code}`);
  }

  dropped(topic: Topic): void {
    this.calls.push(`dropped ${topic.name}`);
  }

  reset(): void {
    this.calls.push("reset");
  }
}

function setup(
  options: {
    random?: number;
    checkSession?: () => Promise<SessionCheck>;
  } = {},
) {
  vi.useFakeTimers();
  const sockets = new FakeSockets();
  const sink = new RecordingSink();
  const session = { answer: "active" as SessionCheck | "never", checks: 0 };
  const signedOut = vi.fn();
  const errors: string[] = [];
  const client = new RealtimeClient({
    url: URL,
    createSocket: sockets.create,
    sink,
    checkSession: () => {
      session.checks += 1;
      if (options.checkSession !== undefined) return options.checkSession();
      if (session.answer === "never") return new Promise(() => {});
      return Promise.resolve(session.answer);
    },
    onSignedOut: signedOut,
    random: () => options.random ?? 0,
    log: {
      error: (message: unknown) => {
        errors.push(String(message));
      },
    },
  });
  onTestFinished(() => {
    client.stop();
    vi.useRealTimers();
  });
  return { client, sockets, sink, session, signedOut, errors };
}

function hello(socket: FakeWebSocket, bootId: string = BOOT_ID): void {
  socket.receive({
    type: "hello",
    bootId,
    user: { id: USER_ID, username: "rob" },
  });
}

/** Accepts the upgrade and sends hello. */
function connect(socket: FakeWebSocket, bootId: string = BOOT_ID): void {
  socket.accept();
  hello(socket, bootId);
}

function fleetSnapshot(socket: FakeWebSocket, seq: number): void {
  socket.receive({
    type: "snapshot",
    topic: FLEET,
    seq,
    data: [printerSnapshot("printer-1", "Sim 1", { seq })],
  });
}

function fleetEvent(socket: FakeWebSocket, seq: number): void {
  socket.receive({
    type: "event",
    topic: FLEET,
    event: eventOf("printer.telemetry", seq),
  });
}

/** Lets promises and timers due now run. */
async function settle(): Promise<void> {
  await vi.advanceTimersByTimeAsync(0);
}

describe("connecting", () => {
  it("connects to the URL and is live once hello arrives", () => {
    const { client, sockets } = setup();

    client.start();

    expect(client.status).toBe("connecting");
    expect(sockets.last.url).toBe(URL);
    sockets.last.accept();
    expect(client.status).toBe("connecting");
    hello(sockets.last);
    expect(client.status).toBe("live");
  });

  it("subscribes nothing before hello, then every topic in use", () => {
    const { client, sockets } = setup();
    client.retain(FLEET);
    client.retain(PRINTER);
    client.start();

    sockets.last.accept();
    expect(sockets.last.sent).toEqual([]);
    hello(sockets.last);

    expect(sockets.last.sent).toEqual([
      { type: "subscribe", topic: FLEET },
      { type: "subscribe", topic: PRINTER },
    ]);
  });

  it("subscribes a topic retained while live at once", () => {
    const { client, sockets } = setup();
    client.start();
    connect(sockets.last);

    client.retain(FLEET);

    expect(sockets.last.sent).toEqual([{ type: "subscribe", topic: FLEET }]);
  });

  it("tells status listeners about each change, until they stop", () => {
    const { client, sockets } = setup();
    const seen: string[] = [];
    const stop = client.onStatus(() => seen.push(client.status));

    client.start();
    connect(sockets.last);
    stop();
    client.stop();

    expect(seen).toEqual(["connecting", "live"]);
  });
});

describe("reference counting", () => {
  it("subscribes a topic once however many retain it, and unsubscribes after the last release", async () => {
    const { client, sockets, sink } = setup();
    client.start();
    connect(sockets.last);

    const first = client.retain(FLEET);
    const second = client.retain(FLEET);
    first();
    await settle();

    expect(sockets.last.sent).toEqual([{ type: "subscribe", topic: FLEET }]);
    second();
    await settle();
    expect(sockets.last.sent).toEqual([
      { type: "subscribe", topic: FLEET },
      { type: "unsubscribe", topic: FLEET },
    ]);
    expect(sink.calls).toEqual(["dropped fleet"]);
  });

  it("counts topics that mean the same as one, as the server keys them", async () => {
    const { client, sockets } = setup();
    client.start();
    connect(sockets.last);

    client.retain({
      name: "events",
      types: ["command.result", "command.requested"],
    });
    const release = client.retain({
      name: "events",
      types: ["command.requested", "command.result", "command.requested"],
      includeTelemetry: false,
    });
    release();
    await settle();

    expect(sockets.last.topics()).toEqual([
      JSON.stringify({
        name: "events",
        types: ["command.result", "command.requested"],
      }),
    ]);
    expect(sockets.last.sent).toHaveLength(1);
  });

  it("keeps the subscription when a release is followed at once by a retain", async () => {
    const { client, sockets, sink } = setup();
    client.start();
    connect(sockets.last);

    const release = client.retain(FLEET);
    release();
    client.retain(FLEET);
    await settle();

    expect(sockets.last.sent).toEqual([{ type: "subscribe", topic: FLEET }]);
    expect(sink.calls).toEqual([]);
  });

  it("counts each release function once", async () => {
    const { client, sockets } = setup();
    client.start();
    connect(sockets.last);

    client.retain(FLEET);
    const release = client.retain(FLEET);
    release();
    release();
    await settle();

    expect(sockets.last.topics()).toEqual([JSON.stringify(FLEET)]);
  });

  it("forgets a topic released while disconnected, and doesn't subscribe it later", async () => {
    const { client, sockets, sink } = setup();
    const release = client.retain(FLEET);
    client.retain(PRINTER);
    release();
    await settle();

    client.start();
    connect(sockets.last);

    expect(sockets.last.sent).toEqual([{ type: "subscribe", topic: PRINTER }]);
    expect(sink.calls).toEqual(["dropped fleet"]);
  });
});

describe("snapshots and events", () => {
  it("hands over a topic's snapshot, then its events in order", () => {
    const { client, sockets, sink } = setup();
    client.retain(FLEET);
    client.start();
    connect(sockets.last);

    fleetSnapshot(sockets.last, 42);
    fleetEvent(sockets.last, 43);
    fleetEvent(sockets.last, 44);

    expect(sink.calls).toEqual([
      "snapshot fleet 42",
      "event fleet 43",
      "event fleet 44",
    ]);
  });

  it("drops a topic's events until its snapshot arrives", () => {
    const { client, sockets, sink } = setup();
    client.retain(FLEET);
    client.start();
    connect(sockets.last);

    fleetEvent(sockets.last, 43);
    fleetSnapshot(sockets.last, 44);
    fleetEvent(sockets.last, 45);

    expect(sink.calls).toEqual(["snapshot fleet 44", "event fleet 45"]);
  });

  it("drops events no newer than what the topic has", () => {
    const { client, sockets, sink } = setup();
    client.retain(FLEET);
    client.start();
    connect(sockets.last);

    fleetSnapshot(sockets.last, 42);
    fleetEvent(sockets.last, 41);
    fleetEvent(sockets.last, 42);
    fleetEvent(sockets.last, 43);
    fleetEvent(sockets.last, 43);

    expect(sink.calls).toEqual(["snapshot fleet 42", "event fleet 43"]);
  });

  it("takes a later snapshot (a resync) as the new starting point", () => {
    const { client, sockets, sink } = setup();
    client.retain(FLEET);
    client.start();
    connect(sockets.last);

    fleetSnapshot(sockets.last, 42);
    fleetEvent(sockets.last, 43);
    fleetSnapshot(sockets.last, 50);
    fleetEvent(sockets.last, 49);
    fleetEvent(sockets.last, 51);

    expect(sink.calls).toEqual([
      "snapshot fleet 42",
      "event fleet 43",
      "snapshot fleet 50",
      "event fleet 51",
    ]);
  });

  it("keeps each topic's seq apart", () => {
    const { client, sockets, sink } = setup();
    client.retain(FLEET);
    client.retain(PRINTER);
    client.start();
    connect(sockets.last);

    fleetSnapshot(sockets.last, 42);
    sockets.last.receive({
      type: "snapshot",
      topic: PRINTER,
      seq: 40,
      data: printerSnapshot("printer-1", "Sim 1"),
    });
    const event = eventOf("printer.telemetry", 41);
    sockets.last.receive({ type: "event", topic: FLEET, event });
    sockets.last.receive({ type: "event", topic: PRINTER, event });

    expect(sink.calls).toEqual([
      "snapshot fleet 42",
      "snapshot printer 40",
      "event printer 41",
    ]);
  });

  it("ignores snapshots and events for topics no longer in use", async () => {
    const { client, sockets, sink } = setup();
    const release = client.retain(FLEET);
    client.start();
    connect(sockets.last);
    release();
    await settle();

    fleetSnapshot(sockets.last, 42);
    fleetEvent(sockets.last, 43);

    expect(sink.calls).toEqual(["dropped fleet"]);
  });

  it("asks for a fresh snapshot when the sink can't apply an event, and drops events until it comes", () => {
    const { client, sockets, sink } = setup();
    client.retain(FLEET);
    client.start();
    connect(sockets.last);
    fleetSnapshot(sockets.last, 42);

    sink.answer = "resync";
    fleetEvent(sockets.last, 43);
    sink.answer = "applied";
    fleetEvent(sockets.last, 44);
    fleetSnapshot(sockets.last, 44);
    fleetEvent(sockets.last, 45);

    expect(sockets.last.sent).toEqual([
      { type: "subscribe", topic: FLEET },
      { type: "subscribe", topic: FLEET },
    ]);
    expect(sink.calls).toEqual([
      "snapshot fleet 42",
      "event fleet 43",
      "snapshot fleet 44",
      "event fleet 45",
    ]);
  });

  it("resync() asks for a fresh snapshot of a topic in use, and ignores others", () => {
    const { client, sockets } = setup();
    client.retain(FLEET);
    client.start();
    connect(sockets.last);

    client.resync(FLEET);
    client.resync(PRINTER);

    expect(sockets.last.sent).toEqual([
      { type: "subscribe", topic: FLEET },
      { type: "subscribe", topic: FLEET },
    ]);
  });

  it("passes a refused topic to the sink, logging only unexpected codes", () => {
    const { client, sockets, sink, errors } = setup();
    client.retain(PRINTER);
    client.start();
    connect(sockets.last);

    sockets.last.receive({
      type: "error",
      code: "printer_not_found",
      message: "There is no printer printer-1.",
      topic: PRINTER,
    });
    sockets.last.receive({
      type: "error",
      code: "too_many_topics",
      message: "A connection can have at most 100 topics.",
      topic: PRINTER,
    });
    sockets.last.receive({
      type: "error",
      code: "invalid_message",
      message: "Bad.",
    });

    expect(sink.calls).toEqual([
      "refused printer printer_not_found",
      "refused printer too_many_topics",
    ]);
    expect(errors).toEqual([
      "The server refused a WebSocket message: too_many_topics: A connection can have at most 100 topics.",
      "The server refused a WebSocket message: invalid_message: Bad.",
    ]);
  });
});

describe("event listeners", () => {
  function printerSnapshotMessage(socket: FakeWebSocket, seq: number): void {
    socket.receive({
      type: "snapshot",
      topic: PRINTER,
      seq,
      data: printerSnapshot("printer-1", "Sim 1", { seq }),
    });
  }

  function printerEvent(socket: FakeWebSocket, seq: number): void {
    socket.receive({
      type: "event",
      topic: PRINTER,
      event: eventOf("printer.telemetry", seq),
    });
  }

  /** Records what a listener hears, after what the sink was handed. */
  function listen(client: RealtimeClient, sink: RecordingSink): string[] {
    const heard: string[] = [];
    client.onEvent((event) => {
      heard.push(`${event.seq} after ${sink.calls.at(-1) ?? "nothing"}`);
    });
    return heard;
  }

  it("hears each event once, after the sink, though it arrives on every topic it matches", () => {
    const { client, sockets, sink } = setup();
    client.retain(FLEET);
    client.retain(PRINTER);
    const heard = listen(client, sink);
    client.start();
    connect(sockets.last);
    fleetSnapshot(sockets.last, 42);
    printerSnapshotMessage(sockets.last, 42);

    fleetEvent(sockets.last, 43);
    printerEvent(sockets.last, 43);
    fleetEvent(sockets.last, 44);
    printerEvent(sockets.last, 44);

    expect(heard).toEqual([
      "43 after event fleet 43",
      "44 after event fleet 44",
    ]);
    expect(sink.calls.filter((call) => call.startsWith("event"))).toHaveLength(
      4,
    );
  });

  it("hears an event that only a later topic gets", () => {
    const { client, sockets, sink } = setup();
    client.retain(FLEET);
    client.retain(PRINTER);
    const heard = listen(client, sink);
    client.start();
    connect(sockets.last);
    printerSnapshotMessage(sockets.last, 42);

    // The fleet's snapshot hasn't come, so the fleet drops 43.
    fleetEvent(sockets.last, 43);
    printerEvent(sockets.last, 43);

    expect(heard).toEqual(["43 after event printer 43"]);
  });

  it("hears nothing the topics drop", () => {
    const { client, sockets, sink } = setup();
    client.retain(FLEET);
    const heard = listen(client, sink);
    client.start();
    connect(sockets.last);

    fleetEvent(sockets.last, 41);
    fleetSnapshot(sockets.last, 42);
    fleetEvent(sockets.last, 42);

    expect(heard).toEqual([]);
  });

  it("hears events the sink can't apply", () => {
    const { client, sockets, sink } = setup();
    client.retain(FLEET);
    const heard = listen(client, sink);
    client.start();
    connect(sockets.last);
    fleetSnapshot(sockets.last, 42);
    sink.answer = "resync";

    fleetEvent(sockets.last, 43);

    expect(heard).toEqual(["43 after event fleet 43"]);
  });

  it("hears a restarted server's lower seqs", async () => {
    const { client, sockets, sink } = setup();
    client.retain(FLEET);
    const heard = listen(client, sink);
    client.start();
    connect(sockets.last);
    fleetSnapshot(sockets.last, 42);
    fleetEvent(sockets.last, 43);

    sockets.last.drop();
    await vi.advanceTimersByTimeAsync(250);
    connect(sockets.last, OTHER_BOOT);
    fleetSnapshot(sockets.last, 3);
    fleetEvent(sockets.last, 4);

    expect(heard).toEqual(["43 after event fleet 43", "4 after event fleet 4"]);
  });

  it("stops calling a listener once it stops listening", () => {
    const { client, sockets } = setup();
    client.retain(FLEET);
    const heard: number[] = [];
    const stop = client.onEvent((event) => {
      heard.push(event.seq);
    });
    client.start();
    connect(sockets.last);
    fleetSnapshot(sockets.last, 42);
    fleetEvent(sockets.last, 43);

    stop();
    fleetEvent(sockets.last, 44);

    expect(heard).toEqual([43]);
  });

  it("still calls the other listeners when one throws, and logs it", () => {
    const { client, sockets, errors } = setup();
    client.retain(FLEET);
    const heard: number[] = [];
    client.onEvent(() => {
      throw new Error("A bug in a listener.");
    });
    client.onEvent((event) => {
      heard.push(event.seq);
    });
    client.start();
    connect(sockets.last);
    fleetSnapshot(sockets.last, 42);

    fleetEvent(sockets.last, 43);

    expect(heard).toEqual([43]);
    expect(errors).toEqual(["A realtime event listener failed."]);
  });
});

describe("invalid messages", () => {
  it("resyncs the topic a message that fails its check was for", () => {
    const { client, sockets, sink, errors } = setup();
    client.retain(FLEET);
    client.retain(PRINTER);
    client.start();
    connect(sockets.last);
    fleetSnapshot(sockets.last, 42);

    sockets.last.receiveRaw(
      JSON.stringify({ type: "event", topic: FLEET, event: { seq: 43 } }),
    );
    fleetEvent(sockets.last, 44);

    expect(sockets.last.sent.slice(2)).toEqual([
      { type: "subscribe", topic: FLEET },
    ]);
    expect(sink.calls).toEqual(["snapshot fleet 42"]);
    expect(errors).toEqual([
      expect.stringContaining(
        "The server sent a WebSocket message that isn't valid; resyncing.",
      ) as unknown,
    ]);
  });

  it("resyncs every topic when a bad message's topic can't be told", () => {
    const { client, sockets, errors } = setup();
    client.retain(FLEET);
    client.retain(PRINTER);
    client.start();
    connect(sockets.last);

    sockets.last.receiveRaw("{not json");

    expect(sockets.last.sent.slice(2)).toEqual([
      { type: "subscribe", topic: FLEET },
      { type: "subscribe", topic: PRINTER },
    ]);
    expect(errors).toEqual([
      "The server sent a WebSocket message that isn't JSON.",
    ]);
  });

  it("ignores binary messages", () => {
    const { client, sockets, errors } = setup();
    client.retain(FLEET);
    client.start();
    connect(sockets.last);

    sockets.last.receiveRaw(new ArrayBuffer(4));

    expect(sockets.last.sent).toHaveLength(1);
    expect(errors).toEqual([
      "The server sent a binary WebSocket message; ignored it.",
    ]);
  });

  it("gives up on a connection whose hello isn't valid", async () => {
    const { client, sockets } = setup();
    client.start();
    sockets.last.accept();

    sockets.last.receiveRaw(JSON.stringify({ type: "hello", bootId: BOOT_ID }));
    await settle();

    expect(sockets.last.closedWith).toEqual({
      code: 4000,
      reason: "The server's messages aren't valid.",
    });
    expect(client.status).toBe("connecting");
    await vi.advanceTimersByTimeAsync(500);
    expect(sockets.all).toHaveLength(2);
  });
});

describe("reconnecting", () => {
  it("subscribes every topic in use again on the new connection", async () => {
    const { client, sockets } = setup();
    client.retain(FLEET);
    const release = client.retain(PRINTER);
    client.start();
    connect(sockets.last);

    sockets.last.drop();
    release();
    await vi.advanceTimersByTimeAsync(250);
    connect(sockets.last);

    expect(sockets.all).toHaveLength(2);
    expect(sockets.last.sent).toEqual([{ type: "subscribe", topic: FLEET }]);
  });

  it("drops events until each topic's new snapshot arrives", async () => {
    const { client, sockets, sink } = setup();
    client.retain(FLEET);
    client.start();
    connect(sockets.last);
    fleetSnapshot(sockets.last, 42);

    sockets.last.drop();
    await vi.advanceTimersByTimeAsync(250);
    connect(sockets.last);
    fleetEvent(sockets.last, 50);
    fleetSnapshot(sockets.last, 50);
    fleetEvent(sockets.last, 51);

    expect(sink.calls).toEqual([
      "snapshot fleet 42",
      "snapshot fleet 50",
      "event fleet 51",
    ]);
  });

  it("keeps the data after reconnecting to the same server", async () => {
    const { client, sockets, sink } = setup();
    client.retain(FLEET);
    client.start();
    connect(sockets.last);

    sockets.last.drop();
    await vi.advanceTimersByTimeAsync(250);
    connect(sockets.last, BOOT_ID);

    expect(sink.calls).not.toContain("reset");
  });

  it("resets everything when the server has restarted (a new bootId), then takes its lower seqs", async () => {
    const { client, sockets, sink } = setup();
    client.retain(FLEET);
    client.start();
    connect(sockets.last);
    fleetSnapshot(sockets.last, 42);

    sockets.last.drop();
    await vi.advanceTimersByTimeAsync(250);
    connect(sockets.last, OTHER_BOOT);
    fleetSnapshot(sockets.last, 3);
    fleetEvent(sockets.last, 4);

    expect(sink.calls).toEqual([
      "snapshot fleet 42",
      "reset",
      "snapshot fleet 3",
      "event fleet 4",
    ]);
  });

  it("doesn't reset on the first hello", () => {
    const { client, sockets, sink } = setup();
    client.start();
    connect(sockets.last, OTHER_BOOT);

    expect(sink.calls).toEqual([]);
  });

  it.each([
    ["the shortest", 0, [250, 500, 1000, 2000, 4000, 8000, 15_000, 15_000]],
    ["the longest", 1, [500, 1000, 2000, 4000, 8000, 16_000, 30_000, 30_000]],
  ] as const)(
    "backs off, doubling up to 30 s (%s waits)",
    async (_, random, waits) => {
      const { client, sockets } = setup({ random });
      client.start();
      connect(sockets.last);
      sockets.last.drop();

      for (const [attempt, wait] of waits.entries()) {
        await vi.advanceTimersByTimeAsync(wait - 1);
        expect(sockets.all, `before attempt ${attempt + 1}`).toHaveLength(
          attempt + 1,
        );
        await vi.advanceTimersByTimeAsync(1);
        expect(sockets.all, `attempt ${attempt + 1}`).toHaveLength(attempt + 2);
        sockets.last.refuse();
        await settle();
      }
    },
  );

  it("starts the backoff again after a successful hello", async () => {
    const { client, sockets } = setup();
    client.start();
    sockets.last.refuse();
    await vi.advanceTimersByTimeAsync(500);
    sockets.last.refuse();
    await vi.advanceTimersByTimeAsync(1000);
    connect(sockets.last);

    sockets.last.drop();
    await vi.advanceTimersByTimeAsync(250);

    expect(sockets.all).toHaveLength(4);
  });

  it("reconnects at once after 4008 (fell too far behind)", async () => {
    const { client, sockets } = setup();
    client.retain(FLEET);
    client.start();
    connect(sockets.last);

    sockets.last.serverClose(4008, "The connection fell too far behind.");
    await settle();
    connect(sockets.last);

    expect(sockets.all).toHaveLength(2);
    expect(sockets.last.sent).toEqual([{ type: "subscribe", topic: FLEET }]);
  });

  it.each([
    [1001, []],
    [1006, []],
    [
      1009,
      [
        "The server closed the WebSocket because a message from this page was too big (1009): a bug.",
      ],
    ],
    [
      1011,
      ["The server closed the WebSocket after an error of its own (1011)."],
    ],
  ] as const)("reconnects with backoff after %i", async (code, logged) => {
    const { client, sockets, errors, session } = setup();
    client.start();
    connect(sockets.last);

    if (code === 1006) sockets.last.drop();
    else sockets.last.serverClose(code);
    await vi.advanceTimersByTimeAsync(249);
    expect(sockets.all).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);

    expect(sockets.all).toHaveLength(2);
    expect(client.status).toBe("reconnecting");
    expect(errors).toEqual(logged);
    expect(session.checks).toBe(0);
  });
});

describe("the session", () => {
  it("signs out on 4401, and doesn't reconnect", async () => {
    const { client, sockets, signedOut } = setup();
    client.start();
    connect(sockets.last);

    sockets.last.serverClose(4401, "The session has ended.");
    await vi.advanceTimersByTimeAsync(60_000);

    expect(signedOut.mock.calls).toEqual([["unauthenticated"]]);
    expect(client.status).toBe("stopped");
    expect(sockets.all).toHaveLength(1);
  });

  it.each(["unauthenticated", "setup_required"] as const)(
    "asks the server about the session when an upgrade is refused, and signs out on %s",
    async (answer) => {
      const { client, sockets, session, signedOut } = setup();
      session.answer = answer;
      client.start();

      sockets.last.refuse();
      await settle();
      await vi.advanceTimersByTimeAsync(60_000);

      expect(session.checks).toBe(1);
      expect(signedOut.mock.calls).toEqual([[answer]]);
      expect(client.status).toBe("stopped");
      expect(sockets.all).toHaveLength(1);
    },
  );

  it.each(["active", "unknown"] as const)(
    "reconnects with backoff when the session is %s",
    async (answer) => {
      const { client, sockets, session, signedOut } = setup();
      session.answer = answer;
      client.start();

      sockets.last.refuse();
      await settle();
      await vi.advanceTimersByTimeAsync(500);

      expect(sockets.all).toHaveLength(2);
      expect(signedOut).not.toHaveBeenCalled();
    },
  );

  it("takes a session check with no answer within 10 s as unknown", async () => {
    const { client, sockets, session } = setup();
    session.answer = "never";
    client.start();

    sockets.last.refuse();
    await vi.advanceTimersByTimeAsync(10_000 - 1);
    expect(sockets.all).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1 + 500);

    expect(sockets.all).toHaveLength(2);
  });

  it("takes a session check that fails as unknown", async () => {
    const { client, sockets } = setup({
      checkSession: () => Promise.reject(new TypeError("Failed to fetch")),
    });

    client.start();
    sockets.last.refuse();
    await settle();
    await vi.advanceTimersByTimeAsync(500);

    expect(sockets.all).toHaveLength(2);
  });

  it("checks the session when a connection closes before hello, but not after", async () => {
    const { client, sockets, session } = setup();
    client.start();
    sockets.last.accept();
    sockets.last.serverClose(1001);
    await settle();
    expect(session.checks).toBe(1);

    await vi.advanceTimersByTimeAsync(500);
    connect(sockets.last);
    sockets.last.serverClose(1001);
    await settle();

    expect(session.checks).toBe(1);
  });
});

describe("status", () => {
  it("is connecting until the first hello, however many attempts fail", async () => {
    const { client, sockets } = setup();
    client.start();

    sockets.last.refuse();
    await settle();

    expect(client.status).toBe("connecting");
  });

  it("is reconnecting after losing a live connection, unreachable after 5 failed attempts in a row, and live again on hello", async () => {
    const { client, sockets } = setup();
    client.start();
    connect(sockets.last);
    sockets.last.drop();
    const seen = [client.status];

    for (const wait of [250, 500, 1000, 2000, 4000]) {
      await vi.advanceTimersByTimeAsync(wait);
      sockets.last.refuse();
      await settle();
      seen.push(client.status);
    }
    await vi.advanceTimersByTimeAsync(8000);
    connect(sockets.last);
    seen.push(client.status);

    expect(seen).toEqual([
      "reconnecting",
      "reconnecting",
      "reconnecting",
      "reconnecting",
      "reconnecting",
      "unreachable",
      "live",
    ]);
  });
});

describe("liveness", () => {
  it("pings after 25 s with nothing heard; any message puts it off", async () => {
    const { client, sockets } = setup();
    client.retain(FLEET);
    client.start();
    connect(sockets.last);

    await vi.advanceTimersByTimeAsync(20_000);
    fleetSnapshot(sockets.last, 42);
    await vi.advanceTimersByTimeAsync(25_000 - 1);
    expect(sockets.last.sent).toEqual([{ type: "subscribe", topic: FLEET }]);
    await vi.advanceTimersByTimeAsync(1);

    expect(sockets.last.sent).toEqual([
      { type: "subscribe", topic: FLEET },
      { type: "ping" },
    ]);
  });

  it("keeps a connection that answers its pings", async () => {
    const { client, sockets } = setup();
    client.start();
    connect(sockets.last);

    for (let round = 0; round < 3; round += 1) {
      await vi.advanceTimersByTimeAsync(25_000 + 9_999);
      sockets.last.receive({ type: "pong" });
    }

    expect(sockets.all).toHaveLength(1);
    expect(sockets.last.sent.filter((m) => m.type === "ping")).toHaveLength(3);
    expect(client.status).toBe("live");
  });

  it("gives up on a connection with no answer 10 s after a ping, and reconnects", async () => {
    const { client, sockets } = setup();
    client.retain(FLEET);
    client.start();
    connect(sockets.last);
    const first = sockets.last;

    await vi.advanceTimersByTimeAsync(25_000 + 10_000 - 1);
    expect(first.closedWith).toBeUndefined();
    await vi.advanceTimersByTimeAsync(1);

    expect(first.closedWith).toEqual({
      code: 4000,
      reason: "No answer from the server.",
    });
    expect(client.status).toBe("reconnecting");
    await vi.advanceTimersByTimeAsync(250);
    connect(sockets.last);
    expect(sockets.last.sent).toEqual([{ type: "subscribe", topic: FLEET }]);
  });

  it("ignores the abandoned socket from then on", async () => {
    const { client, sockets, sink } = setup();
    client.retain(FLEET);
    client.start();
    connect(sockets.last);
    const first = sockets.last;
    await vi.advanceTimersByTimeAsync(35_000);

    fleetSnapshot(first, 42);
    first.completeClose();
    await vi.advanceTimersByTimeAsync(250);

    expect(sink.calls).toEqual([]);
    expect(sockets.all).toHaveLength(2);
  });

  it("gives up on an attempt with no hello within 10 s", async () => {
    const { client, sockets, session } = setup();
    client.start();
    sockets.last.accept();

    await vi.advanceTimersByTimeAsync(10_000 - 1);
    expect(sockets.last.closedWith).toBeUndefined();
    await vi.advanceTimersByTimeAsync(1);

    expect(sockets.last.closedWith).toEqual({
      code: 4000,
      reason: "No answer from the server.",
    });
    expect(session.checks).toBe(1);
    await vi.advanceTimersByTimeAsync(500);
    expect(sockets.all).toHaveLength(2);
  });

  it("gives up on an attempt that never connects within 10 s", async () => {
    const { client, sockets } = setup();
    client.start();

    await vi.advanceTimersByTimeAsync(10_000);

    expect(sockets.last.closedWith).toEqual({
      code: 4000,
      reason: "No answer from the server.",
    });
    await vi.advanceTimersByTimeAsync(500);
    expect(sockets.all).toHaveLength(2);
  });
});

describe("stop and start", () => {
  it("closes the socket with 1000 and stops reconnecting", async () => {
    const { client, sockets } = setup();
    client.start();
    connect(sockets.last);

    client.stop();
    await vi.advanceTimersByTimeAsync(60_000);

    expect(sockets.last.closedWith).toEqual({
      code: 1000,
      reason: "The page closed the connection.",
    });
    expect(client.status).toBe("stopped");
    expect(sockets.all).toHaveLength(1);
  });

  it("delivers nothing more after stop", () => {
    const { client, sockets, sink } = setup();
    client.retain(FLEET);
    client.start();
    connect(sockets.last);

    client.stop();
    fleetSnapshot(sockets.last, 42);

    expect(sink.calls).toEqual([]);
  });

  it("ignores a session check that answers after stop", async () => {
    let answer: (result: SessionCheck) => void = () => {};
    const { client, sockets, signedOut } = setup({
      checkSession: () =>
        new Promise((resolve) => {
          answer = resolve;
        }),
    });

    client.start();
    sockets.last.refuse();
    client.stop();
    answer("unauthenticated");
    await vi.advanceTimersByTimeAsync(60_000);

    expect(signedOut).not.toHaveBeenCalled();
    expect(sockets.all).toHaveLength(1);
  });

  it("closes a socket that's still connecting", async () => {
    const { client, sockets } = setup();
    client.start();

    client.stop();
    await settle();

    expect(sockets.last.closedWith).toEqual({
      code: 1000,
      reason: "The page closed the connection.",
    });
    expect(sockets.last.readyState).toBe(3);
  });

  it("starts again after stop, subscribing the topics still in use", () => {
    const { client, sockets } = setup();
    client.retain(FLEET);
    client.start();
    connect(sockets.last);
    client.stop();

    client.start();
    connect(sockets.last);

    expect(sockets.all).toHaveLength(2);
    expect(sockets.last.sent).toEqual([{ type: "subscribe", topic: FLEET }]);
    expect(client.status).toBe("live");
  });

  it("ignores start while running and stop while stopped", () => {
    const { client, sockets } = setup();

    client.stop();
    client.start();
    client.start();

    expect(sockets.all).toHaveLength(1);
  });
});
