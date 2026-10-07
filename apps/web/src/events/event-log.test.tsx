// SPDX-FileCopyrightText: 2026 Open Print Stack contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { act, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { apiError, FakeServer, ROB } from "../test/fake-server.ts";
import { serverWith, snapshotOf } from "../test/printers.ts";
import { heading, location, renderApp, settle } from "../test/render-app.tsx";

// The event log, through the whole app against FakeServer: stored events a
// page at a time, the live tail, the filters in the address, and names.

const LOG = "Event log";
const SAM = { id: "0199b3a0-1c00-7000-8000-00000000a002", username: "sam" };

/** Each row as "printer | label · summary · category | source". */
function rows(): string[] {
  const list = screen.queryByRole("list", { name: "Events" });
  if (list === null) return [];
  return within(list).getAllByRole("listitem").map(rowText);
}

function rowText(item: HTMLElement): string {
  const [, printer, event, source] = [...item.children];
  const parts = [...(event?.children ?? [])].map((each) => each.textContent);
  return [printer?.textContent, parts.join(" · "), source?.textContent].join(
    " | ",
  );
}

async function waitForRows(expected: string[]): Promise<void> {
  await waitFor(() => {
    expect(rows()).toEqual(expected);
  });
}

/** The topics the page's socket has subscribed, as objects. */
function topics(server: FakeServer): unknown[] {
  return server.sockets.last.topics().map((key) => JSON.parse(key) as unknown);
}

const IDLE_TO_PRINTING = {
  previous: "idle",
  status: "printing",
  detail: null,
  error: null,
} as const;

const RUNOUT = {
  severity: "warning",
  code: "filament_runout",
  message: "Filament ran out",
} as const;

describe("the event log", () => {
  it("shows the command events with the username of who sent them (walkthrough step 8)", async () => {
    const server = serverWith();
    const { app, user } = renderApp(server, "/printers/p1");
    await heading("Sim 1");

    await user.click(screen.getByRole("button", { name: "Home all" }));
    await user.click(
      within(screen.getByRole("navigation", { name: "Pages" })).getByRole(
        "link",
        { name: LOG },
      ),
    );

    await heading(LOG);
    expect(location(app)).toBe("/events");
    await waitForRows([
      "Sim 1 | Command result · Home all: done in 1 ms · Commands | rob",
      "Sim 1 | Command requested · Home all · Commands | rob",
    ]);
  });

  it("lists stored events newest first: time, printer, what happened, its category and who caused it", async () => {
    const server = serverWith();
    server.publishGlobal("system.started", { version: "0.1.0" });
    server.publishGlobal("auth.login_failed", { username: "bob" });
    server.publish("printer.status_changed", "p1", IDLE_TO_PRINTING);
    server.publish("printer.alert", "p1", RUNOUT, {
      ts: "2026-10-05T12:34:56.789Z",
    });
    renderApp(server, "/events");

    await waitForRows([
      "Sim 1 | Alert · Warning: Filament ran out · Printer state | Printer",
      "Sim 1 | Status changed · Idle → Printing · Printer state | Printer",
      "— | Login failed · Username “bob” · Logins | System",
      "— | Server started · Version 0.1.0 · Server | System",
    ]);
    const newest = within(screen.getByRole("list", { name: "Events" }))
      .getAllByRole("listitem")
      .at(0);
    if (newest === undefined) throw new Error("No rows.");
    // In the browser's time zone (the tests' is London, an hour ahead in
    // October), with the exact time in the tooltip.
    const time = newest.querySelector("time");
    expect(time?.textContent).toBe("5 Oct 2026, 13:34:56");
    expect(time?.getAttribute("title")).toBe("2026-10-05T12:34:56.789Z");
    expect(time?.getAttribute("datetime")).toBe("2026-10-05T12:34:56.789Z");
  });

  it("shows each event as JSON under Details", async () => {
    const server = serverWith();
    const alert = server.publish("printer.alert", "p1", RUNOUT);
    const { user } = renderApp(server, "/events");
    await waitForRows([
      "Sim 1 | Alert · Warning: Filament ran out · Printer state | Printer",
    ]);

    const details = screen.getByText("Details").closest("details");
    if (details === null) throw new Error("No Details.");
    expect(details.open).toBe(false);
    await user.click(screen.getByText("Details"));

    expect(details.open).toBe(true);
    const json = within(details).getByText(/"printer.alert"/).textContent;
    expect(JSON.parse(json ?? "")).toEqual(alert);
  });

  it("pages back 100 at a time with Load older events, until the oldest", async () => {
    const server = serverWith();
    for (let n = 1; n <= 250; n += 1) {
      server.publish("printer.job_started", "p1", { fileName: `${n}.gcode` });
    }
    const { user } = renderApp(server, "/events");

    await waitFor(() => {
      expect(rows()).toHaveLength(100);
    });
    expect(rows()[0]).toBe(
      "Sim 1 | Job started · 250.gcode · Printer state | Printer",
    );
    expect(rows()[99]).toContain("151.gcode");
    expect(screen.queryByText("That's the oldest event.")).toBeNull();

    await user.click(screen.getByRole("button", { name: "Load older events" }));
    await waitFor(() => {
      expect(rows()).toHaveLength(200);
    });
    expect(rows()[199]).toContain("51.gcode");
    await user.click(screen.getByRole("button", { name: "Load older events" }));

    await waitFor(() => {
      expect(rows()).toHaveLength(250);
    });
    expect(rows()[249]).toContain(" 1.gcode");
    expect(screen.getByText("That's the oldest event.")).toBeDefined();
    expect(
      screen.queryByRole("button", { name: "Load older events" }),
    ).toBeNull();
    expect(server.searchesTo("GET /api/events")).toEqual([
      "",
      "before=151",
      "before=51",
    ]);
  });

  it("waits for the live tail's snapshot before fetching, so an event in between shows once", async () => {
    const server = serverWith();
    server.holdSnapshots.add("events");
    server.publish("printer.status_changed", "p1", IDLE_TO_PRINTING);
    renderApp(server, "/events");
    await heading(LOG);
    await settle();

    expect(screen.getByText("Loading events…")).toBeDefined();
    expect(server.searchesTo("GET /api/events")).toEqual([]);

    act(() => {
      server.releaseSnapshots();
      // Live, and stored before the page is fetched.
      server.publish("printer.alert", "p1", RUNOUT);
    });

    await waitForRows([
      "Sim 1 | Alert · Warning: Filament ran out · Printer state | Printer",
      "Sim 1 | Status changed · Idle → Printing · Printer state | Printer",
    ]);
    expect(server.searchesTo("GET /api/events")).toEqual([""]);
  });

  it("waits for the fleet too, so no current printer shows as deleted", async () => {
    const server = serverWith();
    server.holdSnapshots.add("fleet");
    server.publish("printer.alert", "p1", RUNOUT);
    renderApp(server, "/events");
    await waitFor(() => {
      expect(server.searchesTo("GET /api/events")).toEqual([""]);
    });
    await settle();

    expect(screen.getByText("Loading events…")).toBeDefined();
    expect(screen.queryByText("Deleted printer")).toBeNull();

    act(() => {
      server.releaseSnapshots();
    });

    await waitForRows([
      "Sim 1 | Alert · Warning: Filament ran out · Printer state | Printer",
    ]);
  });

  it("adds new events at the top as they happen, without fetching again", async () => {
    const server = serverWith();
    server.publish("printer.status_changed", "p1", IDLE_TO_PRINTING);
    renderApp(server, "/events");
    await waitForRows([
      "Sim 1 | Status changed · Idle → Printing · Printer state | Printer",
    ]);

    act(() => {
      server.publish("printer.alert", "p1", RUNOUT);
      server.publishGlobal("auth.logout", {});
    });

    await waitForRows([
      "— | Logged out · Logins | rob",
      "Sim 1 | Alert · Warning: Filament ran out · Printer state | Printer",
      "Sim 1 | Status changed · Idle → Printing · Printer state | Printer",
    ]);
    expect(server.searchesTo("GET /api/events")).toEqual([""]);
  });

  it("lists stored telemetry with the switch on, but never adds it live", async () => {
    const server = serverWith();
    server.publish("printer.telemetry", "p1", {
      telemetry: {
        temperatures: {
          nozzle: { actualC: 214.62, targetC: 215 },
          bed: { actualC: 60, targetC: 0 },
        },
        fans: {},
        speedPercent: 100,
        position: null,
        homedAxes: null,
        job: {
          fileName: "benchy.gcode",
          progressPercent: 42,
          elapsedS: null,
          remainingS: null,
          currentLayer: null,
          totalLayers: null,
        },
      },
    });
    server.publish("printer.alert", "p1", RUNOUT);
    const { app, user } = renderApp(server, "/events");
    await waitForRows([
      "Sim 1 | Alert · Warning: Filament ran out · Printer state | Printer",
    ]);
    expect(screen.queryByText("New telemetry appears when you reload.")).toBe(
      null,
    );

    await user.click(screen.getByRole("switch", { name: "Include telemetry" }));

    expect(location(app)).toBe("/events?telemetry=true");
    await waitForRows([
      "Sim 1 | Alert · Warning: Filament ran out · Printer state | Printer",
      "Sim 1 | Telemetry · Nozzle 214.6 °C / 215 °C · Bed 60 °C / off · benchy.gcode 42 % · Telemetry | Printer",
    ]);
    expect(
      screen.getByText("New telemetry appears when you reload."),
    ).toBeDefined();
    expect(server.searchesTo("GET /api/events")).toEqual([
      "",
      "includeTelemetry=true",
    ]);
    expect(topics(server)).toEqual([{ name: "fleet" }, { name: "events" }]);

    act(() => {
      server.publish("printer.telemetry", "p1", {
        telemetry: {
          temperatures: {},
          fans: {},
          speedPercent: null,
          position: null,
          homedAxes: null,
          job: null,
        },
      });
      server.publish("printer.job_started", "p1", { fileName: "next.gcode" });
    });

    await waitFor(() => {
      expect(rows()).toHaveLength(3);
    });
    expect(rows()[0]).toBe(
      "Sim 1 | Job started · next.gcode · Printer state | Printer",
    );
  });

  it("filters by printer, live too", async () => {
    const server = serverWith();
    server.addPrinter(snapshotOf({ id: "p2", name: "Sim 2" }));
    server.publish("printer.alert", "p1", RUNOUT);
    server.publish("printer.job_started", "p2", { fileName: "two.gcode" });
    const { app, user } = renderApp(server, "/events");
    await waitFor(() => {
      expect(rows()).toHaveLength(2);
    });

    await user.selectOptions(screen.getByLabelText("Printer"), "Sim 2");

    expect(location(app)).toBe("/events?printer=p2");
    await waitForRows([
      "Sim 2 | Job started · two.gcode · Printer state | Printer",
    ]);
    expect(server.searchesTo("GET /api/events")).toEqual(["", "printerId=p2"]);
    await waitFor(() => {
      expect(topics(server)).toEqual([
        { name: "fleet" },
        { name: "events", printerId: "p2" },
      ]);
    });

    act(() => {
      server.publish("printer.alert", "p1", RUNOUT);
      server.publish("printer.job_ended", "p2", {
        outcome: "completed",
        fileName: "two.gcode",
      });
    });

    await waitForRows([
      "Sim 2 | Job ended · two.gcode finished · Printer state | Printer",
      "Sim 2 | Job started · two.gcode · Printer state | Printer",
    ]);
    await user.selectOptions(screen.getByLabelText("Printer"), "All printers");
    expect(location(app)).toBe("/events");
  });

  it("filters by type, a category choosing all its types, live too", async () => {
    const server = serverWith();
    server.publish("printer.alert", "p1", RUNOUT);
    const { app, user } = renderApp(server, "/printers/p1");
    await heading("Sim 1");
    await user.click(screen.getByRole("button", { name: "Home all" }));
    await user.click(
      within(screen.getByRole("main")).getByRole("link", { name: LOG }),
    );
    await waitFor(() => {
      expect(rows()).toHaveLength(3);
    });
    expect(location(app)).toBe("/events?printer=p1");

    await user.click(screen.getByRole("button", { name: "All types" }));
    await user.click(
      screen.getByRole("checkbox", { name: "Command requested" }),
    );

    expect(location(app)).toBe("/events?printer=p1&types=command.requested");
    await waitForRows([
      "Sim 1 | Command requested · Home all · Commands | rob",
    ]);
    expect(screen.getByRole("button", { name: "1 type" })).toBeDefined();
    const commands = screen.getByRole("checkbox", { name: "Commands" });
    expect(commands.getAttribute("aria-checked")).toBe("mixed");

    await user.click(commands);

    expect(location(app)).toBe(
      "/events?printer=p1&types=command.requested+command.result",
    );
    await waitForRows([
      "Sim 1 | Command result · Home all: done in 1 ms · Commands | rob",
      "Sim 1 | Command requested · Home all · Commands | rob",
    ]);
    expect(commands.getAttribute("aria-checked")).toBe("true");
    expect(server.searchesTo("GET /api/events")).toEqual([
      "printerId=p1",
      "printerId=p1&type=command.requested",
      "printerId=p1&type=command.requested&type=command.result",
    ]);
    await waitFor(() => {
      expect(topics(server)).toContainEqual({
        name: "events",
        printerId: "p1",
        types: ["command.requested", "command.result"],
      });
    });

    act(() => {
      server.publish("printer.alert", "p1", RUNOUT);
      server.publish(
        "command.requested",
        "p1",
        {
          commandId: "0199b3a0-1c00-7000-8000-00000000c0ff",
          command: { kind: "print.pause" },
        },
        { correlationId: "0199b3a0-1c00-7000-8000-00000000c0ff" },
      );
    });
    await waitFor(() => {
      expect(rows()[0]).toBe(
        "Sim 1 | Command requested · Pause the print · Commands | rob",
      );
    });
    expect(rows()).toHaveLength(3);

    await user.click(screen.getByRole("button", { name: "Show every type" }));
    expect(location(app)).toBe("/events?printer=p1");
  });

  it("adds telemetry as one more type when types are chosen", async () => {
    const server = serverWith();
    const { app, user } = renderApp(
      server,
      "/events?types=printer.alert&telemetry=true",
    );
    await screen.findByText("No events match these filters.");

    expect(server.searchesTo("GET /api/events")).toEqual([
      "type=printer.alert&type=printer.telemetry&includeTelemetry=true",
    ]);
    expect(topics(server)).toEqual([
      { name: "fleet" },
      { name: "events", types: ["printer.alert"] },
    ]);
    await user.click(screen.getByRole("switch", { name: "Include telemetry" }));
    expect(location(app)).toBe("/events?types=printer.alert");
  });

  it("reads the filters from the address, dropping what doesn't make sense", async () => {
    const server = serverWith();
    renderApp(
      server,
      "/events?types=printer.alert,nope,printer.telemetry,command.result,printer.alert&telemetry=yes&printer=",
    );
    await screen.findByText("No events match these filters.");

    expect(server.searchesTo("GET /api/events")).toEqual([
      "type=printer.alert&type=command.result",
    ]);
    expect(screen.getByRole("button", { name: "2 types" })).toBeDefined();
    expect(
      screen.getByRole("switch", { name: "Include telemetry" }).ariaChecked,
    ).toBe("false");
    expect(screen.getByLabelText<HTMLSelectElement>("Printer").value).toBe("");
  });

  it("replaces the history entry on a filter change, so Back leaves the log", async () => {
    const server = serverWith();
    const { app, user } = renderApp(server, "/");
    await heading("Printers");
    await user.click(screen.getByRole("link", { name: LOG }));
    await screen.findByText("No events yet.");

    await user.selectOptions(screen.getByLabelText("Printer"), "Sim 1");
    await user.click(screen.getByRole("switch", { name: "Include telemetry" }));
    expect(location(app)).toBe("/events?printer=p1&telemetry=true");
    act(() => {
      app.router.history.back();
    });

    await heading("Printers");
    expect(location(app)).toBe("/");
  });

  it("says when there are no events, or none match", async () => {
    const server = serverWith();
    const { user } = renderApp(server, "/events");

    await screen.findByText("No events yet.");
    expect(screen.queryByText("That's the oldest event.")).toBeNull();
    await user.selectOptions(screen.getByLabelText("Printer"), "Sim 1");
    await screen.findByText("No events match these filters.");
  });

  it("names a deleted printer from its printer.removed event, or as Deleted printer", async () => {
    const server = serverWith();
    server.publish("printer.added", "p9", {
      name: "Old",
      driverType: "simulated",
    });
    server.publish("printer.job_started", "p8", { fileName: "lost.gcode" });
    server.publish("printer.removed", "p9", { name: "Old" });
    renderApp(server, "/events");

    await waitForRows([
      "Old (deleted) | Printer deleted · Old · Printer setup | rob",
      "Deleted printer | Job started · lost.gcode · Printer state | Printer",
      "Old (deleted) | Printer added · Old (simulated) · Printer setup | rob",
    ]);
    expect(screen.getByText("Deleted printer").getAttribute("title")).toBe(
      "p8",
    );
    expect(screen.getAllByText("Old (deleted)")[0]?.getAttribute("title")).toBe(
      "p9",
    );
    // Only a chosen printer that's gone is in the filter.
    expect(
      [...screen.getByLabelText<HTMLSelectElement>("Printer").options].map(
        (option) => option.textContent,
      ),
    ).toEqual(["All printers", "Sim 1"]);
  });

  it("keeps a deleted printer chosen in the printer filter", async () => {
    const server = serverWith();
    server.publish("printer.removed", "p9", { name: "Old" });
    renderApp(server, "/events?printer=p9");

    await waitForRows([
      "Old (deleted) | Printer deleted · Old · Printer setup | rob",
    ]);
    const select = screen.getByLabelText<HTMLSelectElement>("Printer");
    expect(select.value).toBe("p9");
    expect([...select.options].map((option) => option.textContent)).toEqual([
      "All printers",
      "Sim 1",
      "Old (deleted)",
    ]);
  });

  it("names users from the pages and the logged-in user, and others as A user", async () => {
    const server = serverWith();
    server.users.push({ ...SAM, password: "another long password" });
    server.publishGlobal(
      "auth.login_succeeded",
      {},
      {
        source: { kind: "user", userId: SAM.id },
      },
    );
    renderApp(server, "/events");
    await waitForRows(["— | Logged in · Logins | sam"]);

    act(() => {
      server.publishGlobal(
        "auth.logout",
        {},
        {
          source: { kind: "user", userId: ROB.id },
        },
      );
      server.publishGlobal(
        "auth.login_succeeded",
        {},
        {
          source: {
            kind: "user",
            userId: "0199b3a0-1c00-7000-8000-00000000a003",
          },
        },
      );
    });

    await waitForRows([
      "— | Logged in · Logins | A user",
      "— | Logged out · Logins | rob",
      "— | Logged in · Logins | sam",
    ]);
  });

  it("after a reconnect, refetches the loaded pages to fill the gap, keeping the live rows", async () => {
    const server = serverWith();
    server.publish("printer.job_started", "p1", { fileName: "a.gcode" });
    renderApp(server, "/events");
    await waitForRows([
      "Sim 1 | Job started · a.gcode · Printer state | Printer",
    ]);
    act(() => {
      server.publish("printer.job_ended", "p1", {
        outcome: "completed",
        fileName: "a.gcode",
      });
    });
    await waitFor(() => {
      expect(rows()).toHaveLength(2);
    });

    act(() => {
      server.sockets.last.drop();
      // Missed: the page isn't connected.
      server.publish("printer.job_started", "p1", { fileName: "b.gcode" });
    });
    await waitFor(() => {
      expect(server.sockets.all).toHaveLength(2);
    });

    await waitForRows([
      "Sim 1 | Job started · b.gcode · Printer state | Printer",
      "Sim 1 | Job ended · a.gcode finished · Printer state | Printer",
      "Sim 1 | Job started · a.gcode · Printer state | Printer",
    ]);
    expect(server.searchesTo("GET /api/events")).toEqual(["", ""]);
  });

  it("after a server restart, keeps the rows and refetches the pages", async () => {
    const server = serverWith();
    server.publish("printer.job_started", "p1", { fileName: "a.gcode" });
    renderApp(server, "/events");
    await waitForRows([
      "Sim 1 | Job started · a.gcode · Printer state | Printer",
    ]);

    act(() => {
      server.sockets.last.drop();
      server.bootId = "0199b3a0-1c00-7000-8000-00000000b002";
      server.publishGlobal("system.started", { version: "0.1.0" });
    });

    await waitForRows([
      "— | Server started · Version 0.1.0 · Server | System",
      "Sim 1 | Job started · a.gcode · Printer state | Printer",
    ]);
    act(() => {
      server.publish("printer.job_started", "p1", { fileName: "b.gcode" });
    });
    await waitFor(() => {
      expect(rows()[0]).toBe(
        "Sim 1 | Job started · b.gcode · Printer state | Printer",
      );
    });
    expect(rows()).toHaveLength(3);
  });

  it("says why the first page failed, and tries again", async () => {
    const server = serverWith();
    server.publish("printer.alert", "p1", RUNOUT);
    server.overrides.set("GET /api/events", () =>
      apiError(400, "validation_failed", "The request isn't valid."),
    );
    const { user } = renderApp(server, "/events");

    expect((await screen.findByRole("alert")).textContent).toBe(
      "Couldn't load the events: The request isn't valid.",
    );
    server.overrides.clear();
    await user.click(screen.getByRole("button", { name: "Try again" }));

    await waitForRows([
      "Sim 1 | Alert · Warning: Filament ran out · Printer state | Printer",
    ]);
  });

  it("says why a refetch after a reconnect failed, keeping the rows", async () => {
    const server = serverWith();
    server.publish("printer.job_started", "p1", { fileName: "a.gcode" });
    renderApp(server, "/events");
    await waitForRows([
      "Sim 1 | Job started · a.gcode · Printer state | Printer",
    ]);

    server.overrides.set("GET /api/events", () =>
      apiError(400, "validation_failed", "The request isn't valid."),
    );
    act(() => {
      server.sockets.last.drop();
    });

    expect((await screen.findByRole("alert")).textContent).toBe(
      "Couldn't refresh the events: The request isn't valid.",
    );
    expect(rows()).toEqual([
      "Sim 1 | Job started · a.gcode · Printer state | Printer",
    ]);
  });

  it("says why an older page failed, keeping the rows and the button", async () => {
    const server = serverWith();
    for (let n = 1; n <= 101; n += 1) {
      server.publish("printer.job_started", "p1", { fileName: `${n}.gcode` });
    }
    const { user } = renderApp(server, "/events");
    await waitFor(() => {
      expect(rows()).toHaveLength(100);
    });

    server.overrides.set("GET /api/events", () =>
      apiError(400, "validation_failed", "The request isn't valid."),
    );
    await user.click(screen.getByRole("button", { name: "Load older events" }));

    expect((await screen.findByRole("alert")).textContent).toBe(
      "Couldn't load older events: The request isn't valid.",
    );
    expect(rows()).toHaveLength(100);
    server.overrides.clear();
    await user.click(screen.getByRole("button", { name: "Load older events" }));
    await waitFor(() => {
      expect(rows()).toHaveLength(101);
    });
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
