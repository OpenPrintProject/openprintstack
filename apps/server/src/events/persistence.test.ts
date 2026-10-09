// SPDX-FileCopyrightText: 2026 Open Print Stack contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  type OpsEvent,
  type PrinterStatus,
  type Telemetry,
} from "@openprintstack/protocol";
import {
  BOOT_ID,
  filamentFixture,
  PRINTER_ID,
  telemetryFixture,
} from "@openprintstack/protocol/fixtures";
import Database from "better-sqlite3";
import { asc } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { type EventDraft, EventBus } from "../bus/bus.ts";
import { createRepos, type EventsRepo } from "../db/repos/index.ts";
import { events } from "../db/schema.ts";
import { StateStore } from "../state/store.ts";
import { debugLogger, jsonLines, testDatabase } from "../test-utils.ts";
import { EventPersistence } from "./persistence.ts";

const OTHER_ID = "printer-2";
const INTERVAL = 5000;
const driver = { kind: "driver" } as const;

// Timers are fake, but setImmediate is Node's own: writes happen on a real
// event-loop turn, which `tick()` waits for.
beforeEach(() => {
  vi.useFakeTimers({ toNotFake: ["setImmediate", "clearImmediate"] });
});

afterEach(() => {
  vi.useRealTimers();
});

function telemetry(
  speedPercent: number,
  printerId: string = PRINTER_ID,
): EventDraft {
  const reading: Telemetry = { ...telemetryFixture, speedPercent };
  return {
    type: "printer.telemetry",
    printerId,
    source: driver,
    payload: { telemetry: reading },
  };
}

function status(to: PrinterStatus, printerId: string = PRINTER_ID): EventDraft {
  return {
    type: "printer.status_changed",
    printerId,
    source: driver,
    payload: { previous: null, status: to, detail: null, error: null },
  };
}

function alert(code: string): EventDraft {
  return {
    type: "printer.alert",
    printerId: PRINTER_ID,
    source: driver,
    payload: { severity: "info", code, message: "" },
  };
}

function filament(status: "loaded" | "active"): EventDraft {
  const readout = structuredClone(filamentFixture);
  readout.units[0]!.slots[0]!.status = status;
  return {
    type: "printer.filament_changed",
    printerId: PRINTER_ID,
    source: driver,
    payload: { filament: readout },
  };
}

const removed: EventDraft = {
  type: "printer.removed",
  printerId: PRINTER_ID,
  source: { kind: "system" },
  payload: { name: "Sim 1" },
};

type Options = {
  sampleIntervalMs?: number;
  validate?: boolean;
  /** Replaces the repo's insertMany; the real one is passed in. */
  insertMany?: (list: readonly OpsEvent[], real: EventsRepo) => void;
};

async function setup(options: Options = {}) {
  const db = await testDatabase();
  const repos = createRepos(db);
  const { logger, output } = await debugLogger();
  const store = new StateStore({
    lookupPrinter: () => ({ name: "Sim", driverType: "simulated" }),
    logger,
  });
  const bus = new EventBus({
    store,
    logger,
    bootId: BOOT_ID,
    validate: options.validate ?? true,
  });
  const fake = options.insertMany;
  const repo = fake
    ? { insertMany: (list: readonly OpsEvent[]) => fake(list, repos.events) }
    : repos.events;
  const insertMany = vi.spyOn(repo, "insertMany");
  const persistence = new EventPersistence({
    bus,
    events: repo,
    logger,
    sampleIntervalMs: options.sampleIntervalMs ?? INTERVAL,
  });

  /** The stored events' seqs, in row order. */
  const stored = () =>
    db
      .select({ seq: events.seq })
      .from(events)
      .orderBy(asc(events.rowId))
      .all()
      .map((row) => row.seq);

  return { bus, persistence, repos, insertMany, output, stored };
}

/** Waits one event-loop turn, so a pending write runs. */
function tick(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

describe("EventPersistence: non-telemetry events", () => {
  it("writes nothing until the next setImmediate tick, then the tick's events in one transaction", async () => {
    const { bus, insertMany, stored } = await setup();

    bus.publish(alert("a"));
    bus.publish(status("idle"));
    bus.publish(alert("b"));

    expect(insertMany).not.toHaveBeenCalled();
    expect(stored()).toEqual([]);

    await tick();

    expect(insertMany).toHaveBeenCalledTimes(1);
    expect(stored()).toEqual([1, 2, 3]);
  });

  it("writes later events in a later transaction", async () => {
    const { bus, insertMany, stored } = await setup();

    bus.publish(alert("a"));
    await tick();
    bus.publish(alert("b"));
    bus.publish(alert("c"));
    await tick();

    expect(insertMany.mock.calls.map(([list]) => list.length)).toEqual([1, 2]);
    expect(stored()).toEqual([1, 2, 3]);
  });

  it("stores each event exactly as it was published", async () => {
    const { bus, repos } = await setup();

    const published = [
      bus.publish(alert("a")),
      bus.publish(status("printing")),
      bus.publish(telemetry(100)),
    ];
    await tick();

    for (const event of published) {
      expect(repos.events.findById(event.id)).toEqual(event);
    }
  });
});

describe("EventPersistence: filament changes", () => {
  it("writes every one at once, even inside a telemetry window", async () => {
    const { bus, repos, stored } = await setup();
    bus.publish(telemetry(100));
    await tick();

    const changes = [
      bus.publish(filament("active")),
      bus.publish(telemetry(110)),
      bus.publish(filament("loaded")),
      bus.publish(filament("active")),
    ].filter((event) => event.type === "printer.filament_changed");
    await tick();

    // The held telemetry (seq 3) waits for its window; no change does.
    expect(stored()).toEqual([1, 2, 4, 5]);
    for (const event of changes) {
      expect(repos.events.findById(event.id)).toEqual(event);
    }
  });
});

describe("EventPersistence: telemetry throttle", () => {
  it("writes due telemetry in the same transaction as the events around it", async () => {
    const { bus, insertMany, stored } = await setup();

    bus.publish(alert("a"));
    bus.publish(telemetry(100));
    bus.publish(alert("b"));
    await tick();

    expect(insertMany).toHaveBeenCalledTimes(1);
    expect(stored()).toEqual([1, 2, 3]);
  });

  it("writes a printer's first telemetry in the next write", async () => {
    const { bus, stored } = await setup();

    bus.publish(telemetry(100));
    await tick();

    expect(stored()).toEqual([1]);
  });

  it("holds updates inside the window and writes only the newest when it ends", async () => {
    const { bus, stored } = await setup();

    bus.publish(telemetry(100)); // seq 1, written
    vi.advanceTimersByTime(1000);
    bus.publish(telemetry(101)); // seq 2, replaced
    vi.advanceTimersByTime(1000);
    bus.publish(telemetry(102)); // seq 3, held
    vi.advanceTimersByTime(INTERVAL - 2001);
    await tick();

    expect(stored()).toEqual([1]);

    vi.advanceTimersByTime(1);
    await tick();

    expect(stored()).toEqual([1, 3]);
  });

  it("writes once per interval under a steady stream, keeping the last value of each window", async () => {
    const { bus, stored } = await setup();

    // An update every 500 ms for 30 s: seq k + 1 is published at 500k ms.
    bus.publish(telemetry(0));
    await tick();
    for (let k = 1; k <= 60; k++) {
      vi.advanceTimersByTime(500);
      bus.publish(telemetry(k));
      await tick();
    }

    // Written at 0, then at each 5 s mark the update from 500 ms before it.
    expect(stored()).toEqual([1, 10, 20, 30, 40, 50, 60]);
  });

  it("writes straight away again once a window has ended with nothing held", async () => {
    const { bus, stored } = await setup();

    bus.publish(telemetry(100));
    vi.advanceTimersByTime(7000);
    bus.publish(telemetry(101));
    await tick();

    expect(stored()).toEqual([1, 2]);
  });

  it("throttles each printer separately", async () => {
    const { bus, stored } = await setup();

    bus.publish(telemetry(100)); // seq 1, written
    vi.advanceTimersByTime(1000);
    bus.publish(telemetry(100, OTHER_ID)); // seq 2, written
    vi.advanceTimersByTime(1000);
    bus.publish(telemetry(101)); // seq 3, held until 5 s
    bus.publish(telemetry(101, OTHER_ID)); // seq 4, held until 6 s
    vi.advanceTimersByTime(3000);
    await tick();

    expect(stored()).toEqual([1, 2, 3]);

    vi.advanceTimersByTime(1000);
    await tick();

    expect(stored()).toEqual([1, 2, 3, 4]);
  });

  it("writes every update when the interval is 0, with no timers", async () => {
    const { bus, stored } = await setup({ sampleIntervalMs: 0 });

    for (let k = 0; k < 5; k++) bus.publish(telemetry(k));
    await tick();

    expect(stored()).toEqual([1, 2, 3, 4, 5]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("writes a held value after events published since it was held", async () => {
    const { bus, stored } = await setup();

    bus.publish(telemetry(100)); // seq 1
    bus.publish(telemetry(101)); // seq 2, held
    bus.publish(alert("a")); // seq 3
    vi.advanceTimersByTime(INTERVAL);
    await tick();

    expect(stored()).toEqual([1, 3, 2]);
  });
});

describe("EventPersistence: flushing held telemetry", () => {
  it.each<PrinterStatus>(["offline", "connecting"])(
    "writes it before a status change to %s, and closes the window",
    async (to) => {
      const { bus, stored } = await setup();
      bus.publish(telemetry(100)); // seq 1
      bus.publish(telemetry(101)); // seq 2, held

      bus.publish(status(to)); // seq 3
      await tick();

      expect(stored()).toEqual([1, 2, 3]);
      expect(vi.getTimerCount()).toBe(0);

      // Back online: the next reading is written straight away.
      bus.publish(status("idle")); // seq 4
      bus.publish(telemetry(102)); // seq 5
      await tick();

      expect(stored()).toEqual([1, 2, 3, 4, 5]);
    },
  );

  it.each<PrinterStatus>(["idle", "printing", "paused", "error"])(
    "keeps holding it through a change to %s, which is still online",
    async (to) => {
      const { bus, stored } = await setup();
      bus.publish(telemetry(100)); // seq 1
      bus.publish(telemetry(101)); // seq 2, held

      bus.publish(status(to)); // seq 3
      await tick();

      expect(stored()).toEqual([1, 3]);

      vi.advanceTimersByTime(INTERVAL);
      await tick();

      expect(stored()).toEqual([1, 3, 2]);
    },
  );

  it("writes it before printer.removed and forgets the window", async () => {
    const { bus, stored } = await setup();
    bus.publish(telemetry(100)); // seq 1
    bus.publish(telemetry(101)); // seq 2, held

    bus.publish(removed); // seq 3
    await tick();

    expect(stored()).toEqual([1, 2, 3]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("flushes only the printer that went offline", async () => {
    const { bus, stored } = await setup();
    bus.publish(telemetry(100)); // seq 1
    bus.publish(telemetry(100, OTHER_ID)); // seq 2
    bus.publish(telemetry(101)); // seq 3, held
    bus.publish(telemetry(101, OTHER_ID)); // seq 4, held

    bus.publish(status("offline", OTHER_ID)); // seq 5
    await tick();

    expect(stored()).toEqual([1, 2, 4, 5]);

    vi.advanceTimersByTime(INTERVAL);
    await tick();

    expect(stored()).toEqual([1, 2, 4, 5, 3]);
  });

  it("does nothing extra when nothing is held", async () => {
    const { bus, stored } = await setup();
    bus.publish(telemetry(100)); // seq 1

    bus.publish(status("offline")); // seq 2
    vi.advanceTimersByTime(INTERVAL);
    await tick();

    expect(stored()).toEqual([1, 2]);
  });
});

describe("EventPersistence.close", () => {
  it("writes queued events and held telemetry before returning, and clears every timer", async () => {
    const { bus, persistence, stored } = await setup();
    bus.publish(telemetry(100)); // seq 1
    await tick();
    bus.publish(telemetry(101)); // seq 2, held
    bus.publish(telemetry(100, OTHER_ID)); // seq 3, queued
    bus.publish(telemetry(101, OTHER_ID)); // seq 4, held
    bus.publish(alert("a")); // seq 5, queued

    persistence.close();

    expect(stored()).toEqual([1, 3, 5, 2, 4]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("stores nothing published afterwards", async () => {
    const { bus, persistence, stored, insertMany } = await setup();
    persistence.close();

    bus.publish(alert("a"));
    bus.publish(telemetry(100));
    vi.advanceTimersByTime(INTERVAL * 2);
    await tick();

    expect(stored()).toEqual([]);
    expect(insertMany).not.toHaveBeenCalled();
  });

  it("can be called twice", async () => {
    const { bus, persistence, stored } = await setup();
    bus.publish(alert("a"));

    persistence.close();
    persistence.close();

    expect(stored()).toEqual([1]);
  });
});

describe("EventPersistence: failed writes", () => {
  it("writes the rest of a batch when one event is refused, and logs the one it dropped", async () => {
    // With validation off, as in production, the repo's own check refuses it.
    const { bus, insertMany, output, stored } = await setup({
      validate: false,
    });
    const bad = {
      ...alert("bad"),
      payload: { severity: "panic", code: "bad", message: "" },
    } as unknown as EventDraft;

    bus.publish(alert("a")); // seq 1
    const dropped = bus.publish(bad); // seq 2
    bus.publish(alert("c")); // seq 3
    await tick();

    expect(stored()).toEqual([1, 3]);
    expect(insertMany).toHaveBeenCalledTimes(4);
    const lines = jsonLines(output).filter((line) => line.level !== "debug");
    expect(lines).toMatchObject([
      {
        level: "warn",
        component: "persistence",
        events: 3,
        msg: "Couldn't write a batch of events; writing them one at a time",
      },
      {
        level: "error",
        component: "persistence",
        eventId: dropped.id,
        eventType: "printer.alert",
        seq: 2,
        printerId: PRINTER_ID,
        msg: "Couldn't write an event; dropped it",
      },
    ]);
    expect(lines[1]!.err).toMatchObject({ type: "ZodError" });
    expect(lines[1]).not.toHaveProperty("payload");
  });

  it("retries one at a time after a constraint failure", async () => {
    const { bus, stored } = await setup({
      insertMany(list, real) {
        if (list.length > 1) {
          throw new Database.SqliteError(
            "UNIQUE constraint failed: events.id",
            "SQLITE_CONSTRAINT_UNIQUE",
          );
        }
        real.insertMany(list);
      },
    });

    bus.publish(alert("a"));
    bus.publish(alert("b"));
    await tick();

    expect(stored()).toEqual([1, 2]);
  });

  it("drops the whole batch, without retrying, when the database itself fails", async () => {
    const { bus, insertMany, output, stored } = await setup({
      insertMany() {
        throw new Database.SqliteError("database is locked", "SQLITE_BUSY");
      },
    });

    bus.publish(alert("a"));
    bus.publish(alert("b"));
    bus.publish(alert("c"));
    await tick();

    expect(insertMany).toHaveBeenCalledTimes(1);
    expect(stored()).toEqual([]);
    const errors = jsonLines(output).filter((line) => line.level === "error");
    expect(errors).toMatchObject([
      {
        component: "persistence",
        events: 3,
        firstSeq: 1,
        lastSeq: 3,
        msg: "The database couldn't write events; dropped them",
      },
    ]);
    expect(errors[0]!.err).toMatchObject({ code: "SQLITE_BUSY" });

    // The next tick's events are tried again.
    bus.publish(alert("d"));
    await tick();

    expect(insertMany).toHaveBeenCalledTimes(2);
  });

  it("stops retrying, and drops the rest, if the database fails partway", async () => {
    let calls = 0;
    const { bus, insertMany, output, stored } = await setup({
      insertMany(list, real) {
        calls++;
        if (calls === 1) {
          throw new Database.SqliteError(
            "UNIQUE constraint failed: events.id",
            "SQLITE_CONSTRAINT_UNIQUE",
          );
        }
        if (calls === 3) {
          throw new Database.SqliteError(
            "database or disk is full",
            "SQLITE_FULL",
          );
        }
        real.insertMany(list);
      },
    });

    for (const code of ["a", "b", "c", "d"]) bus.publish(alert(code));
    await tick();

    expect(stored()).toEqual([1]);
    expect(insertMany).toHaveBeenCalledTimes(3);
    expect(
      jsonLines(output).filter((line) => line.level === "error"),
    ).toMatchObject([{ events: 3, firstSeq: 2, lastSeq: 4 }]);
  });
});
