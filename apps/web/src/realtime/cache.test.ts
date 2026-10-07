// SPDX-FileCopyrightText: 2026 Open Print Stack contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  emptyTelemetry,
  initialPrinterState,
  type PrinterSnapshot,
  reducePrinterState,
  type Topic,
} from "@openprintstack/protocol";
import { telemetryFixture, TS } from "@openprintstack/protocol/fixtures";
import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";

import { eventLogKeys } from "../events/api.ts";
import { NO_FILTERS } from "../events/filters.ts";
import { eventOf, printerSnapshot } from "../test/fake-socket.ts";
import {
  applyToFleet,
  applyToPrinter,
  type FleetData,
  type LiveEventsData,
  type PrinterData,
  querySink,
  realtimeKeys,
} from "./cache.ts";

const ONE = printerSnapshot("printer-1", "Sim 1", { status: "idle", seq: 10 });
const TWO = printerSnapshot("printer-2", "Sim 2", { status: "idle", seq: 11 });

describe("applyToFleet", () => {
  it("applies a printer's event with reducePrinterState, and keeps its seq", () => {
    const event = eventOf("printer.status_changed", 12, {
      printerId: "printer-2",
    });

    const fleet = applyToFleet([ONE, TWO], event);

    expect(fleet).toEqual([
      ONE,
      { ...TWO, state: reducePrinterState(TWO.state, event), seq: 12 },
    ]);
    expect((fleet as FleetData)[0]).toBe(ONE);
    expect((fleet as FleetData)[1]?.state.status).toBe("error");
  });

  it("clears telemetry when a printer goes offline, as the reducer says", () => {
    const event = eventOf("printer.status_changed", 12, {
      payload: {
        previous: "idle",
        status: "offline",
        detail: null,
        error: null,
      },
    });

    const fleet = applyToFleet([ONE], event) as FleetData;

    expect(fleet[0]?.state.telemetry).toEqual(emptyTelemetry());
  });

  it("adds a printer from printer.added as the server's store does", () => {
    const event = eventOf("printer.added", 12, {
      printerId: "printer-3",
      payload: { name: "Sim 3", driverType: "simulated" },
      ts: "2026-10-06T08:00:00.000Z",
    });

    const fleet = applyToFleet([ONE], event);

    expect(fleet).toEqual([
      ONE,
      {
        printer: { id: "printer-3", name: "Sim 3", driverType: "simulated" },
        state: initialPrinterState("2026-10-06T08:00:00.000Z"),
        seq: 12,
      },
    ]);
  });

  it("removes a printer on printer.removed", () => {
    const event = eventOf("printer.removed", 12, { printerId: "printer-1" });

    expect(applyToFleet([ONE, TWO], event)).toEqual([TWO]);
  });

  it("ignores printer.removed for a printer it doesn't have", () => {
    const fleet = [ONE];
    const event = eventOf("printer.removed", 12, { printerId: "printer-9" });

    expect(applyToFleet(fleet, event)).toBe(fleet);
  });

  it("asks for a fresh snapshot when a printer is renamed (the event doesn't say the new name)", () => {
    const event = eventOf("printer.updated", 12, {
      payload: { changedFields: ["name", "settings"] },
    });

    expect(applyToFleet([ONE], event)).toBe("resync");
  });

  it("applies a settings-only printer.updated without a resync", () => {
    const event = eventOf("printer.updated", 12, {
      payload: { changedFields: ["settings"] },
    });

    expect(applyToFleet([ONE], event)).toEqual([{ ...ONE, seq: 12 }]);
  });

  it("asks for a fresh snapshot for any other event about a printer it doesn't know", () => {
    const event = eventOf("printer.telemetry", 12, { printerId: "printer-9" });

    expect(applyToFleet([ONE], event)).toBe("resync");
  });

  it("ignores events about no printer", () => {
    const fleet = [ONE];

    expect(applyToFleet(fleet, eventOf("auth.logout", 12))).toBe(fleet);
  });
});

describe("applyToPrinter", () => {
  it("applies the printer's events with reducePrinterState", () => {
    const event = eventOf("printer.telemetry", 12);

    expect(applyToPrinter(ONE, event)).toEqual({
      ...ONE,
      state: { ...ONE.state, telemetry: telemetryFixture, updatedAt: TS },
      seq: 12,
    });
  });

  it("is null once the printer is removed, and stays null", () => {
    expect(applyToPrinter(ONE, eventOf("printer.removed", 12))).toBeNull();
    expect(applyToPrinter(null, eventOf("printer.telemetry", 13))).toBeNull();
  });

  it("asks for a fresh snapshot when the printer is renamed", () => {
    const event = eventOf("printer.updated", 12, {
      payload: { changedFields: ["name"] },
    });

    expect(applyToPrinter(ONE, event)).toBe("resync");
  });

  it("ignores another printer's events", () => {
    const event = eventOf("printer.telemetry", 12, { printerId: "printer-2" });

    expect(applyToPrinter(ONE, event)).toBe(ONE);
  });
});

describe("querySink", () => {
  function setup() {
    const queryClient = new QueryClient();
    return { queryClient, sink: querySink(queryClient) };
  }

  it("puts the fleet's snapshot in the cache, and applies its events", () => {
    const { queryClient, sink } = setup();

    sink.snapshot({
      type: "snapshot",
      topic: { name: "fleet" },
      seq: 11,
      data: [ONE, TWO],
    });
    const answer = sink.event(
      { name: "fleet" },
      eventOf("printer.removed", 12),
    );

    expect(answer).toBe("applied");
    expect(queryClient.getQueryData<FleetData>(realtimeKeys.fleet)).toEqual([
      TWO,
    ]);
  });

  it("puts a printer's snapshot in the cache, and applies its events", () => {
    const { queryClient, sink } = setup();
    const topic = { name: "printer", printerId: "printer-1" } as const;

    sink.snapshot({ type: "snapshot", topic, seq: 11, data: ONE });
    sink.event(topic, eventOf("printer.status_changed", 12));

    expect(
      queryClient.getQueryData<PrinterData>(realtimeKeys.printer("printer-1"))
        ?.state.status,
    ).toBe("error");
  });

  it("passes on the reducer's resync, and asks for one when it has no data", () => {
    const { sink } = setup();

    expect(
      sink.event({ name: "fleet" }, eventOf("printer.telemetry", 12)),
    ).toBe("resync");
    sink.snapshot({
      type: "snapshot",
      topic: { name: "fleet" },
      seq: 11,
      data: [ONE],
    });
    expect(
      sink.event(
        { name: "fleet" },
        eventOf("printer.updated", 12, {
          payload: { changedFields: ["name"] },
        }),
      ),
    ).toBe("resync");
  });

  it("keeps an events topic's events from its snapshot, newest first", () => {
    const { queryClient, sink } = setup();
    const topic = { name: "events" } as const;
    const alerts: Topic = { name: "events", types: ["printer.alert"] };
    const logout = eventOf("auth.logout", 12);
    const alert = eventOf("printer.alert", 13);

    sink.snapshot({ type: "snapshot", topic, seq: 11, data: null });
    expect(queryClient.getQueryData(realtimeKeys.events(topic))).toEqual([]);
    sink.snapshot({ type: "snapshot", topic: alerts, seq: 12, data: null });

    expect(sink.event(topic, logout)).toBe("applied");
    expect(sink.event(topic, alert)).toBe("applied");
    expect(sink.event(alerts, alert)).toBe("applied");
    expect(
      queryClient.getQueryData<LiveEventsData>(realtimeKeys.events(topic)),
    ).toEqual([alert, logout]);
    expect(
      queryClient.getQueryData<LiveEventsData>(realtimeKeys.events(alerts)),
    ).toEqual([alert]);
    // Topics that mean the same share their events.
    expect(
      realtimeKeys.events({
        name: "events",
        types: ["printer.alert", "printer.alert"],
        includeTelemetry: false,
      }),
    ).toEqual(realtimeKeys.events(alerts));
  });

  it("asks for an events topic's snapshot if it has none", () => {
    const { sink } = setup();

    expect(sink.event({ name: "events" }, eventOf("auth.logout", 12))).toBe(
      "resync",
    );
  });

  it("on an events topic's later snapshot, keeps its events and refetches the event log's pages", () => {
    const { queryClient, sink } = setup();
    const topic = { name: "events" } as const;
    const logout = eventOf("auth.logout", 12);
    sink.snapshot({ type: "snapshot", topic, seq: 11, data: null });
    sink.event(topic, logout);
    queryClient.setQueryData(eventLogKeys.list(NO_FILTERS), { pages: [] });
    queryClient.setQueryData(["get", "/api/printers"], { printers: [] });

    sink.snapshot({ type: "snapshot", topic, seq: 20, data: null });

    expect(queryClient.getQueryData(realtimeKeys.events(topic))).toEqual([
      logout,
    ]);
    expect(
      queryClient.getQueryState(eventLogKeys.list(NO_FILTERS))?.isInvalidated,
    ).toBe(true);
    expect(
      queryClient.getQueryState(["get", "/api/printers"])?.isInvalidated,
    ).toBe(false);
  });

  it("doesn't refetch the event log on an events topic's first snapshot", () => {
    const { queryClient, sink } = setup();
    queryClient.setQueryData(eventLogKeys.list(NO_FILTERS), { pages: [] });

    sink.snapshot({
      type: "snapshot",
      topic: { name: "events", printerId: "printer-1" },
      seq: 11,
      data: null,
    });

    expect(
      queryClient.getQueryState(eventLogKeys.list(NO_FILTERS))?.isInvalidated,
    ).toBe(false);
  });

  it("records a printer the server doesn't have as null", () => {
    const { queryClient, sink } = setup();
    const topic = { name: "printer", printerId: "printer-9" } as const;

    sink.refused(topic, "printer_not_found");
    sink.refused({ name: "fleet" }, "too_many_topics");

    expect(
      queryClient.getQueryData(realtimeKeys.printer("printer-9")),
    ).toBeNull();
    expect(queryClient.getQueryData(realtimeKeys.fleet)).toBeUndefined();
  });

  it("forgets a dropped topic's data", () => {
    const { queryClient, sink } = setup();
    const topic = { name: "printer", printerId: "printer-1" } as const;
    const events = { name: "events" } as const;
    sink.snapshot({
      type: "snapshot",
      topic: { name: "fleet" },
      seq: 11,
      data: [ONE],
    });
    sink.snapshot({ type: "snapshot", topic, seq: 11, data: ONE });
    sink.snapshot({ type: "snapshot", topic: events, seq: 11, data: null });
    sink.dropped(events);
    expect(
      queryClient.getQueryData(realtimeKeys.events(events)),
    ).toBeUndefined();

    sink.dropped({ name: "fleet" });

    expect(queryClient.getQueryData(realtimeKeys.fleet)).toBeUndefined();
    expect(queryClient.getQueryData(realtimeKeys.printer("printer-1"))).toEqual(
      ONE,
    );
    sink.dropped(topic);
    expect(
      queryClient.getQueryData(realtimeKeys.printer("printer-1")),
    ).toBeUndefined();
  });

  it("on reset, empties the realtime data but the event log's tail, and marks every REST answer stale", () => {
    const { queryClient, sink } = setup();
    const snapshot: PrinterSnapshot = ONE;
    const events = { name: "events" } as const;
    const logout = eventOf("auth.logout", 12);
    sink.snapshot({
      type: "snapshot",
      topic: { name: "fleet" },
      seq: 11,
      data: [snapshot],
    });
    sink.snapshot({ type: "snapshot", topic: events, seq: 11, data: null });
    sink.event(events, logout);
    queryClient.setQueryData(["get", "/api/printers"], {
      printers: [snapshot],
    });

    sink.reset();

    expect(queryClient.getQueryData(realtimeKeys.events(events))).toEqual([
      logout,
    ]);
    expect(queryClient.getQueryData(realtimeKeys.fleet)).toBeUndefined();
    expect(
      queryClient.getQueryCache().find({ queryKey: realtimeKeys.fleet }),
    ).toBeDefined();
    expect(
      queryClient.getQueryCache().find({ queryKey: ["get", "/api/printers"] })
        ?.state.isInvalidated,
    ).toBe(true);
  });
});
