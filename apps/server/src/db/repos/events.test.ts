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
import { describe, expect, it } from "vitest";
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
