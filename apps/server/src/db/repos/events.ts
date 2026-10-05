// SPDX-FileCopyrightText: 2026 Open Print Stack contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { OpsEvent } from "@openprintstack/protocol";
import { eq } from "drizzle-orm";

import type { Db } from "../client.ts";
import { events } from "../schema.ts";

type EventRow = typeof events.$inferSelect;
type NewEventRow = typeof events.$inferInsert;

export class EventsRepo {
  readonly #db: Db;

  constructor(db: Db) {
    this.#db = db;
  }

  /**
   * Writes the events in one transaction: all of them or none. Each is checked
   * against `OpsEvent` first, so an invalid one writes nothing.
   */
  insertMany(list: readonly OpsEvent[]): void {
    const rows = list.map(toRow);
    if (rows.length === 0) return;
    this.#db.transaction((tx) => {
      for (const row of rows) {
        tx.insert(events).values(row).run();
      }
    });
  }

  /** The stored event, checked against `OpsEvent`. */
  findById(id: string): OpsEvent | undefined {
    const row = this.#db.select().from(events).where(eq(events.id, id)).get();
    return row && toEvent(row);
  }
}

function toRow(event: OpsEvent): NewEventRow {
  const parsed = OpsEvent.parse(event);
  const ts = Date.parse(parsed.ts);
  // Stored as milliseconds, so only toISOString()'s form survives unchanged.
  if (new Date(ts).toISOString() !== parsed.ts) {
    throw new Error(
      `Event ${parsed.id} has ts ${parsed.ts}, which isn't in toISOString() form (UTC, with milliseconds).`,
    );
  }
  return {
    id: parsed.id,
    ts,
    bootId: parsed.bootId,
    seq: parsed.seq,
    printerId: parsed.printerId,
    type: parsed.type,
    category: parsed.category,
    source: parsed.source.kind,
    userId: parsed.source.kind === "user" ? parsed.source.userId : null,
    correlationId: parsed.correlationId,
    payload: parsed.payload,
  };
}

function toEvent(row: EventRow): OpsEvent {
  return OpsEvent.parse({
    id: row.id,
    ts: new Date(row.ts).toISOString(),
    seq: row.seq,
    bootId: row.bootId,
    printerId: row.printerId,
    type: row.type,
    category: row.category,
    source:
      row.source === "user"
        ? { kind: "user", userId: row.userId }
        : { kind: row.source },
    correlationId: row.correlationId,
    payload: row.payload,
  });
}
