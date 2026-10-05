// SPDX-FileCopyrightText: 2026 Open Print Stack contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  type EventType,
  initialPrinterState,
  type OpsEventOf,
  type PrinterInfo,
  reducePrinterState,
} from "@openprintstack/protocol";
import {
  capabilitiesFixture,
  eventFixtures,
  eventId,
  PRINTER_ID,
  TS,
  telemetryFixture,
} from "@openprintstack/protocol/fixtures";
import { describe, expect, it, vi } from "vitest";

import { debugLogger, jsonLines } from "../test-utils.ts";
import { type PrinterLookup, StateStore } from "./store.ts";

const OTHER_ID = "printer-2";

/** A fixture event with its own seq (and id), optionally for another printer. */
function event<T extends EventType>(
  type: T,
  seq: number,
  printerId: string = PRINTER_ID,
): OpsEventOf<T> {
  const fixture: OpsEventOf<T> = eventFixtures[type];
  return {
    ...fixture,
    id: eventId(seq),
    seq,
    ...(fixture.printerId === null ? {} : { printerId }),
  };
}

const NAMES = new Map([
  [PRINTER_ID, "Sim 1"],
  [OTHER_ID, "Sim 2"],
]);

/** Finds the two test printers. */
const lookupBoth: PrinterLookup = (id) => {
  const name = NAMES.get(id);
  return name ? { name, driverType: "simulated" } : undefined;
};

async function setup(lookup: PrinterLookup = lookupBoth) {
  const { logger, output } = await debugLogger();
  const lookupPrinter = vi.fn(lookup);
  const store = new StateStore({ lookupPrinter, logger });
  return { store, lookupPrinter, output };
}

const SIM_1: PrinterInfo = {
  id: PRINTER_ID,
  name: "Sim 1",
  driverType: "simulated",
};

describe("StateStore", () => {
  it("starts empty, at seq 0", async () => {
    const { store } = await setup();

    expect(store.list()).toEqual([]);
    expect(store.get(PRINTER_ID)).toBeUndefined();
    expect(store.seq).toBe(0);
  });

  it("adds a printer with its first event, starting from the initial state", async () => {
    const { store } = await setup();
    const status = event("printer.status_changed", 1);

    store.apply(status);

    expect(store.get(PRINTER_ID)).toEqual({
      printer: SIM_1,
      state: reducePrinterState(initialPrinterState(TS), status),
      seq: 1,
    });
    expect(store.get(PRINTER_ID)?.state.status).toBe("error");
  });

  it("applies each event with the shared reducer", async () => {
    const { store } = await setup();
    const events = [
      event("printer.status_changed", 1),
      event("printer.capabilities_changed", 2),
      event("printer.telemetry", 3),
    ];

    for (const e of events) store.apply(e);

    expect(store.get(PRINTER_ID)?.state).toEqual(
      events.reduce(reducePrinterState, initialPrinterState(TS)),
    );
    expect(store.get(PRINTER_ID)?.state).toMatchObject({
      capabilities: capabilitiesFixture,
      telemetry: telemetryFixture,
    });
  });

  it("keeps only the name and driver type from the lookup", async () => {
    const { store } = await setup(() => ({
      id: "a-different-id",
      name: "Sim 1",
      driverType: "simulated",
      settings: { apiKey: "secret" },
      settingsVersion: 3,
    }));

    store.apply(event("printer.alert", 1));

    expect(store.get(PRINTER_ID)?.printer).toEqual(SIM_1);
  });

  it("looks a printer up when it first appears and after printer.updated, not otherwise", async () => {
    let name = "Sim 1";
    const { store, lookupPrinter } = await setup(() => ({
      name,
      driverType: "simulated",
    }));

    store.apply(event("printer.status_changed", 1));
    store.apply(event("printer.telemetry", 2));
    name = "Renamed";
    store.apply(event("printer.alert", 3));
    expect(store.get(PRINTER_ID)?.printer.name).toBe("Sim 1");
    store.apply(event("printer.updated", 4));

    expect(lookupPrinter.mock.calls).toEqual([[PRINTER_ID], [PRINTER_ID]]);
    expect(store.get(PRINTER_ID)?.printer.name).toBe("Renamed");
    expect(store.get(PRINTER_ID)?.state.telemetry).toEqual(telemetryFixture);
  });

  it("forgets a printer on printer.removed, without looking it up", async () => {
    const { store, lookupPrinter } = await setup();
    store.apply(event("printer.status_changed", 1));
    store.apply(event("printer.status_changed", 2, OTHER_ID));
    lookupPrinter.mockClear();

    store.apply(event("printer.removed", 3));

    expect(store.get(PRINTER_ID)).toBeUndefined();
    expect(store.list().map((s) => s.printer.id)).toEqual([OTHER_ID]);
    expect(lookupPrinter).not.toHaveBeenCalled();
    expect(store.seq).toBe(3);
  });

  it("skips an event for a printer the lookup doesn't know, with a warning", async () => {
    const { store, output } = await setup(() => undefined);
    const alert = event("printer.alert", 7);

    store.apply(alert);

    expect(store.list()).toEqual([]);
    expect(store.seq).toBe(7);
    expect(jsonLines(output)).toMatchObject([
      {
        level: "warn",
        component: "state",
        eventId: alert.id,
        eventType: "printer.alert",
        seq: 7,
        printerId: PRINTER_ID,
        msg: "Skipped an event for a printer the state store doesn't know",
      },
    ]);
    expect(jsonLines(output)[0]).not.toHaveProperty("payload");
  });

  it("skips an event that arrives after the printer was removed", async () => {
    let exists = true;
    const { store, output } = await setup((id) =>
      exists ? lookupBoth(id) : undefined,
    );
    store.apply(event("printer.status_changed", 1));
    exists = false;
    store.apply(event("printer.removed", 2));

    store.apply(event("printer.status_changed", 3));

    expect(store.get(PRINTER_ID)).toBeUndefined();
    expect(jsonLines(output).map((line) => line.level)).toEqual(["warn"]);
  });

  it("keeps the old name if the lookup finds nothing after printer.updated", async () => {
    let found = true;
    const { store, output } = await setup(() =>
      found ? { name: "Sim 1", driverType: "simulated" } : undefined,
    );
    store.apply(event("printer.status_changed", 1));
    found = false;

    store.apply(event("printer.updated", 2));

    expect(store.get(PRINTER_ID)).toMatchObject({ printer: SIM_1, seq: 1 });
    expect(jsonLines(output).map((line) => line.level)).toEqual(["warn"]);
  });

  it("tracks the last seq overall, and each printer's last seq", async () => {
    const { store } = await setup();

    store.apply(event("printer.status_changed", 1));
    store.apply(event("printer.status_changed", 2, OTHER_ID));
    store.apply(event("printer.telemetry", 3));
    store.apply(event("system.started", 4));

    expect(store.seq).toBe(4);
    expect(store.get(PRINTER_ID)?.seq).toBe(3);
    expect(store.get(OTHER_ID)?.seq).toBe(2);
  });

  it("moves a printer's seq on for events that don't change its state", async () => {
    const { store } = await setup();
    store.apply(event("printer.status_changed", 1));
    const before = store.get(PRINTER_ID);

    store.apply(event("printer.alert", 2));

    expect(store.get(PRINTER_ID)?.state).toBe(before?.state);
    expect(store.get(PRINTER_ID)?.seq).toBe(2);
  });

  it("ignores events that aren't about a printer, apart from the seq", async () => {
    const { store, lookupPrinter } = await setup();

    store.apply(event("auth.login_succeeded", 1));
    store.apply(event("system.started", 2));

    expect(store.list()).toEqual([]);
    expect(store.seq).toBe(2);
    expect(lookupPrinter).not.toHaveBeenCalled();
  });

  it("lists printers in the order it first saw them", async () => {
    const { store } = await setup();

    store.apply(event("printer.status_changed", 1, OTHER_ID));
    store.apply(event("printer.status_changed", 2));
    store.apply(event("printer.telemetry", 3, OTHER_ID));

    expect(store.list().map((s) => s.printer.id)).toEqual([
      OTHER_ID,
      PRINTER_ID,
    ]);
  });

  it("replaces a printer's snapshot on each event, leaving the old one unchanged", async () => {
    const { store } = await setup();
    store.apply(event("printer.status_changed", 1));
    const before = store.get(PRINTER_ID)!;
    const copy = structuredClone(before);

    store.apply(event("printer.telemetry", 2));

    expect(store.get(PRINTER_ID)).not.toBe(before);
    expect(before).toEqual(copy);
  });
});
