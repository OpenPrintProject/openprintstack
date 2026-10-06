// SPDX-FileCopyrightText: 2026 Open Print Stack contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { EventType, type OpsEvent } from "@openprintstack/protocol";
import {
  BOOT_ID,
  COMMAND_ID,
  eventFixtures,
  eventId,
  PRINTER_ID,
  TS,
  USER_ID,
} from "@openprintstack/protocol/fixtures";
import { asc } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { testDatabase } from "../../test-utils.ts";
import type { Db } from "../client.ts";
import { events } from "../schema.ts";
import { EventsRepo } from "./events.ts";

const ALL: OpsEvent[] = Object.values(eventFixtures);

async function setup(): Promise<{ db: Db; repo: EventsRepo }> {
  const db = await testDatabase();
  return { db, repo: new EventsRepo(db) };
}

function count(db: Db): unknown {
  return db.$client.prepare("SELECT count(*) FROM events").pluck().get();
}

describe("EventsRepo", () => {
  it("has a fixture for every event type", () => {
    expect(ALL.map((event) => event.type).sort()).toEqual(
      [...EventType.options].sort(),
    );
  });

  it("reads back every event type exactly as it was written", async () => {
    const { repo } = await setup();

    repo.insertMany(ALL);

    for (const event of ALL) {
      expect(repo.findById(event.id), event.type).toEqual(event);
    }
  });

  it("finds nothing for an unknown id", async () => {
    const { repo } = await setup();

    expect(repo.findById(eventId(999))).toBeUndefined();
  });

  it("stores the envelope in its own columns", async () => {
    const { db, repo } = await setup();
    const command = eventFixtures["command.requested"];
    const telemetry = eventFixtures["printer.telemetry"];
    const started = eventFixtures["system.started"];

    repo.insertMany([command, telemetry, started]);

    expect(db.select().from(events).orderBy(asc(events.rowId)).all()).toEqual([
      {
        rowId: 1,
        id: command.id,
        ts: Date.parse(TS),
        bootId: BOOT_ID,
        seq: command.seq,
        printerId: PRINTER_ID,
        type: "command.requested",
        category: "command",
        source: "user",
        userId: USER_ID,
        correlationId: COMMAND_ID,
        payload: command.payload,
      },
      {
        rowId: 2,
        id: telemetry.id,
        ts: Date.parse(TS),
        bootId: BOOT_ID,
        seq: telemetry.seq,
        printerId: PRINTER_ID,
        type: "printer.telemetry",
        category: "telemetry",
        source: "driver",
        userId: null,
        correlationId: null,
        payload: telemetry.payload,
      },
      {
        rowId: 3,
        id: started.id,
        ts: Date.parse(TS),
        bootId: BOOT_ID,
        seq: started.seq,
        printerId: null,
        type: "system.started",
        category: "system",
        source: "system",
        userId: null,
        correlationId: null,
        payload: started.payload,
      },
    ]);
  });

  it("numbers rows in the order they're written, across batches", async () => {
    const { db, repo } = await setup();
    const [a, b, c] = ALL;

    repo.insertMany([c!, a!]);
    repo.insertMany([b!]);

    expect(
      db
        .select({ rowId: events.rowId, id: events.id })
        .from(events)
        .orderBy(asc(events.rowId))
        .all(),
    ).toEqual([
      { rowId: 1, id: c!.id },
      { rowId: 2, id: a!.id },
      { rowId: 3, id: b!.id },
    ]);
  });

  it("does nothing for an empty list", async () => {
    const { db, repo } = await setup();

    repo.insertMany([]);

    expect(count(db)).toBe(0);
  });

  it("writes all of a batch or none of it", async () => {
    const { db, repo } = await setup();
    const [a, b] = ALL;
    repo.insertMany([a!]);

    // b is new, but the copy of a has a's id.
    expect(() => repo.insertMany([b!, { ...a!, seq: 99 }])).toThrow(
      expect.objectContaining({
        code: "SQLITE_CONSTRAINT_UNIQUE",
        message: "UNIQUE constraint failed: events.id",
      }),
    );
    expect(count(db)).toBe(1);
    expect(repo.findById(b!.id)).toBeUndefined();
  });

  it("refuses an invalid event before writing any of the batch", async () => {
    const { db, repo } = await setup();
    const telemetry = eventFixtures["printer.telemetry"];
    const wrongCategory = { ...telemetry, id: eventId(100), category: "state" };

    expect(() =>
      repo.insertMany([
        eventFixtures["system.started"],
        wrongCategory as OpsEvent,
      ]),
    ).toThrow(z.ZodError);
    expect(count(db)).toBe(0);
  });

  it.each([
    "2026-10-05T12:00:00Z",
    "2026-10-05T12:00:00.1Z",
    "2026-10-05T12:00:00.000123Z",
  ])("refuses ts %s, which milliseconds can't reproduce", async (ts) => {
    const { db, repo } = await setup();
    const event = { ...eventFixtures["system.started"], ts };

    expect(() => repo.insertMany([event])).toThrow(
      `Event ${event.id} has ts ${ts}, which isn't in toISOString() form (UTC, with milliseconds).`,
    );
    expect(count(db)).toBe(0);
  });

  it("checks stored events when reading", async () => {
    const { db, repo } = await setup();
    const started = eventFixtures["system.started"];
    const alert = eventFixtures["printer.alert"];
    repo.insertMany([started, alert]);
    const update = db.$client.prepare(
      "UPDATE events SET payload = ? WHERE id = ?",
    );
    update.run(JSON.stringify({ unexpected: true }), started.id);
    update.run(
      JSON.stringify({ severity: "panic", code: "x", message: "" }),
      alert.id,
    );

    expect(() => repo.findById(started.id)).toThrow(z.ZodError);
    expect(() => repo.findById(alert.id)).toThrow(z.ZodError);
  });

  it("refuses a stored user event with no user id", async () => {
    const { db, repo } = await setup();
    const login = eventFixtures["auth.login_succeeded"];
    repo.insertMany([login]);
    db.$client
      .prepare("UPDATE events SET user_id = NULL WHERE id = ?")
      .run(login.id);

    expect(() => repo.findById(login.id)).toThrow(z.ZodError);
  });
});

describe("EventsRepo.deleteTelemetryBefore", () => {
  const cutoff = Date.parse(TS);

  /** A copy of the fixture with its own id, `msBefore` ms before the cutoff. */
  function before(fixture: OpsEvent, msBefore: number, n: number): OpsEvent {
    return {
      ...fixture,
      id: eventId(100 + n),
      ts: new Date(cutoff - msBefore).toISOString(),
    };
  }

  it("deletes only telemetry from before the cutoff", async () => {
    const { db, repo } = await setup();
    const old = ALL.map((event, n) => before(event, 1000, n));
    const atCutoff = before(eventFixtures["printer.telemetry"], 0, 50);
    repo.insertMany([...old, atCutoff]);

    expect(repo.deleteTelemetryBefore(cutoff, 100)).toBe(1);

    expect(
      db
        .select({ type: events.type })
        .from(events)
        .orderBy(asc(events.rowId))
        .all()
        .map((row) => row.type),
    ).toEqual([
      ...ALL.map((event) => event.type).filter(
        (t) => t !== "printer.telemetry",
      ),
      "printer.telemetry",
    ]);
    expect(repo.findById(atCutoff.id)).toEqual(atCutoff);
  });

  it("deletes at most `limit` rows per call and returns how many", async () => {
    const { db, repo } = await setup();
    const telemetry = eventFixtures["printer.telemetry"];
    repo.insertMany([1, 2, 3].map((n) => before(telemetry, n, n)));

    expect(repo.deleteTelemetryBefore(cutoff, 2)).toBe(2);
    expect(count(db)).toBe(1);
    expect(repo.deleteTelemetryBefore(cutoff, 2)).toBe(1);
    expect(repo.deleteTelemetryBefore(cutoff, 2)).toBe(0);
    expect(count(db)).toBe(0);
  });
});

describe("EventsRepo.page", () => {
  const OTHER_PRINTER = "printer-2";
  let next = 1000;

  /** A copy of the fixture with its own id, for `printerId` if it has one. */
  function copy<T extends EventType>(
    type: T,
    printerId: string = PRINTER_ID,
  ): OpsEvent {
    const fixture = eventFixtures[type];
    return {
      ...fixture,
      id: eventId(next++),
      ...(fixture.printerId !== null && { printerId }),
    } as OpsEvent;
  }

  /** Writes the events one batch each, so their row ids follow the list. */
  async function written(list: OpsEvent[]) {
    const { db, repo } = await setup();
    for (const event of list) repo.insertMany([event]);
    const rowIds = new Map(
      db
        .select({ id: events.id, rowId: events.rowId })
        .from(events)
        .all()
        .map((row) => [row.id, row.rowId]),
    );
    return { db, repo, rowId: (event: OpsEvent) => rowIds.get(event.id) };
  }

  const ids = (list: readonly OpsEvent[]) => list.map((event) => event.id);

  it("returns events newest first, page by page, with no gaps or repeats", async () => {
    const list = [
      copy("printer.status_changed"),
      copy("command.requested"),
      copy("command.result"),
      copy("auth.login_succeeded"),
      copy("printer.alert"),
      copy("printer.job_started"),
      copy("system.started"),
    ];
    const { repo, rowId } = await written(list);

    const first = repo.page({ limit: 3 });
    const second = repo.page({ limit: 3, before: first.nextCursor ?? 0 });
    const third = repo.page({ limit: 3, before: second.nextCursor ?? 0 });

    expect(ids(first.events)).toEqual(ids(list.slice(4).reverse()));
    expect(first.nextCursor).toBe(rowId(list[4]!));
    expect(ids(second.events)).toEqual(ids(list.slice(1, 4).reverse()));
    expect(second.nextCursor).toBe(rowId(list[1]!));
    expect(ids(third.events)).toEqual(ids([list[0]!]));
    expect(third.nextCursor).toBeNull();
  });

  it("has no next page when the last one is exactly full", async () => {
    const list = [copy("command.requested"), copy("command.result")];
    const { repo } = await written(list);

    expect(repo.page({ limit: 2 })).toEqual({
      events: [...list].reverse(),
      nextCursor: null,
    });
  });

  it("returns the stored events exactly", async () => {
    const list = Object.keys(eventFixtures).map((type) =>
      copy(type as EventType),
    );
    const { repo } = await written(list);

    expect(repo.page({ limit: 100, includeTelemetry: true }).events).toEqual(
      [...list].reverse(),
    );
  });

  it("starts before the cursor, without the cursor's own event", async () => {
    const list = [copy("command.requested"), copy("command.result")];
    const { repo, rowId } = await written(list);

    expect(
      ids(repo.page({ limit: 10, before: rowId(list[1]!) ?? 0 }).events),
    ).toEqual(ids([list[0]!]));
    expect(
      repo.page({ limit: 10, before: rowId(list[0]!) ?? 0 }).events,
    ).toEqual([]);
  });

  describe("telemetry", () => {
    const list = () => [
      copy("printer.status_changed"),
      copy("printer.telemetry"),
      copy("command.result"),
      copy("printer.telemetry"),
    ];

    it("is left out by default", async () => {
      const events = list();
      const { repo } = await written(events);

      expect(ids(repo.page({ limit: 10 }).events)).toEqual(
        ids([events[2]!, events[0]!]),
      );
      expect(
        ids(repo.page({ limit: 10, includeTelemetry: false }).events),
      ).toEqual(ids([events[2]!, events[0]!]));
    });

    it("is included when asked for", async () => {
      const events = list();
      const { repo } = await written(events);

      expect(
        ids(repo.page({ limit: 10, includeTelemetry: true }).events),
      ).toEqual(ids([...events].reverse()));
    });

    it("is included when a type or category filter names it", async () => {
      const events = list();
      const { repo } = await written(events);

      expect(
        ids(
          repo.page({
            limit: 10,
            types: ["printer.telemetry", "command.result"],
          }).events,
        ),
      ).toEqual(ids([events[3]!, events[2]!, events[1]!]));
      expect(
        ids(repo.page({ limit: 10, categories: ["telemetry"] }).events),
      ).toEqual(ids([events[3]!, events[1]!]));
    });
  });

  describe("filters", () => {
    const list = () => [
      copy("printer.status_changed", PRINTER_ID),
      copy("command.requested", OTHER_PRINTER),
      copy("command.result", PRINTER_ID),
      copy("auth.login_failed"),
      copy("printer.alert", OTHER_PRINTER),
      copy("command.result", OTHER_PRINTER),
    ];

    it("keeps one printer's events", async () => {
      const events = list();
      const { repo } = await written(events);

      expect(
        ids(repo.page({ limit: 10, printerId: OTHER_PRINTER }).events),
      ).toEqual(ids([events[5]!, events[4]!, events[1]!]));
    });

    it("keeps any of the given types", async () => {
      const events = list();
      const { repo } = await written(events);

      expect(
        ids(repo.page({ limit: 10, types: ["command.result"] }).events),
      ).toEqual(ids([events[5]!, events[2]!]));
      expect(
        ids(
          repo.page({
            limit: 10,
            types: ["auth.login_failed", "printer.status_changed"],
          }).events,
        ),
      ).toEqual(ids([events[3]!, events[0]!]));
    });

    it("keeps any of the given categories", async () => {
      const events = list();
      const { repo } = await written(events);

      expect(
        ids(repo.page({ limit: 10, categories: ["auth", "state"] }).events),
      ).toEqual(ids([events[4]!, events[3]!, events[0]!]));
    });

    it("combines filters", async () => {
      const events = list();
      const { repo } = await written(events);

      expect(
        ids(
          repo.page({
            limit: 10,
            printerId: OTHER_PRINTER,
            categories: ["command"],
            types: ["command.result"],
          }).events,
        ),
      ).toEqual(ids([events[5]!]));
    });

    it("treats empty lists as no filter", async () => {
      const events = list();
      const { repo } = await written(events);

      expect(
        ids(repo.page({ limit: 10, types: [], categories: [] }).events),
      ).toEqual(ids([...events].reverse()));
    });

    it("pages within a filter", async () => {
      const events = list();
      const { repo, rowId } = await written(events);

      const first = repo.page({ limit: 2, printerId: OTHER_PRINTER });

      expect(first.nextCursor).toBe(rowId(events[4]!));
      expect(
        ids(
          repo.page({
            limit: 2,
            printerId: OTHER_PRINTER,
            before: first.nextCursor ?? 0,
          }).events,
        ),
      ).toEqual(ids([events[1]!]));
    });
  });

  it.each([0, -1, 1.5, NaN])("refuses a limit of %s", async (limit) => {
    const { repo } = await written([]);
    expect(() => repo.page({ limit })).toThrow("The page limit");
  });

  describe("query plans", () => {
    /** SQLite's plan for the query `page` runs, as EXPLAIN QUERY PLAN lines. */
    async function planFor(query: Parameters<EventsRepo["page"]>[0]) {
      const { db, repo } = await written([copy("command.result")]);
      const client = db.$client;
      let captured: { sql: string; params: unknown[] } | undefined;
      const prepare = client.prepare.bind(client);
      const spy = vi.spyOn(client, "prepare").mockImplementation((sql) => {
        const statement = prepare(sql);
        const all = statement.all.bind(statement);
        statement.all = (...params: unknown[]) => {
          captured = { sql, params };
          return all(...params);
        };
        return statement;
      });
      repo.page(query);
      spy.mockRestore();
      if (captured === undefined) throw new Error("No query ran.");
      return (
        client
          .prepare(`EXPLAIN QUERY PLAN ${captured.sql}`)
          .all(...captured.params) as { detail: string }[]
      ).map((row) => row.detail);
    }

    it.each([
      ["no filter", {}, "SEARCH events USING INTEGER PRIMARY KEY (rowid<?)"],
      [
        "a printer",
        { printerId: PRINTER_ID },
        "SEARCH events USING INDEX events_printer_id_row_id_idx (printer_id=? AND row_id<?)",
      ],
      [
        "a type",
        { types: ["command.result"] },
        "SEARCH events USING INDEX events_type_row_id_idx (type=? AND row_id<?)",
      ],
      [
        "a category",
        { categories: ["command"] },
        "SEARCH events USING INDEX events_category_row_id_idx (category=? AND row_id<?)",
      ],
    ] as const)(
      "reads %s through an index in row_id order, without sorting",
      async (_, filter, plan) => {
        expect(await planFor({ limit: 10, before: 100, ...filter })).toEqual([
          plan,
        ]);
      },
    );
  });
});
