// SPDX-FileCopyrightText: 2026 Open Print Stack contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  type EventCategory,
  type EventType,
  OpsEvent,
} from "@openprintstack/protocol";
import { and, desc, eq, inArray, lt, ne, type SQL } from "drizzle-orm";

import type { Db } from "../client.ts";
import { events } from "../schema.ts";

type EventRow = typeof events.$inferSelect;
type NewEventRow = typeof events.$inferInsert;

/** Which events a page holds. Empty lists are the same as leaving them out. */
export type EventPageQuery = {
  printerId?: string;
  /** Any of these types. */
  types?: readonly EventType[];
  /** Any of these categories. */
  categories?: readonly EventCategory[];
  /**
   * Telemetry is left out unless this is true, or `types` or `categories`
   * names it.
   */
  includeTelemetry?: boolean;
  /** Only events written before this one: the previous page's `nextCursor`. */
  before?: number;
  /** At most this many events. */
  limit: number;
};

export type EventPage = {
  /** Newest first, in the order they were written. */
  events: OpsEvent[];
  /** The `before` for the next (older) page, or null if there's none. */
  nextCursor: number | null;
};

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

  /**
   * Deletes up to `limit` telemetry events with `ts` before `cutoffMs` and
   * returns how many it deleted. Other categories are never deleted. Uses
   * `events_category_ts_idx`.
   */
  deleteTelemetryBefore(cutoffMs: number, limit: number): number {
    const batch = this.#db
      .select({ rowId: events.rowId })
      .from(events)
      .where(and(eq(events.category, "telemetry"), lt(events.ts, cutoffMs)))
      .limit(limit);
    return this.#db.delete(events).where(inArray(events.rowId, batch)).run()
      .changes;
  }

  /**
   * One page of events, newest first by `row_id` (the order they were
   * written). Each filter has an index on (filter, row_id), so a page reads
   * only the rows it returns; several types or categories at once sort just
   * the rows of those.
   */
  page(query: EventPageQuery): EventPage {
    if (!Number.isInteger(query.limit) || query.limit < 1) {
      throw new Error(
        `The page limit must be a whole number from 1: ${query.limit}`,
      );
    }
    const types = query.types ?? [];
    const categories = query.categories ?? [];
    const conditions: SQL[] = [];
    if (query.printerId !== undefined) {
      conditions.push(eq(events.printerId, query.printerId));
    }
    if (types.length > 0) {
      conditions.push(inArray(events.type, [...types]));
    }
    if (categories.length > 0) {
      conditions.push(inArray(events.category, [...categories]));
    }
    const namesTelemetry =
      types.includes("printer.telemetry") || categories.includes("telemetry");
    if (query.includeTelemetry !== true && !namesTelemetry) {
      conditions.push(ne(events.category, "telemetry"));
    }
    if (query.before !== undefined) {
      conditions.push(lt(events.rowId, query.before));
    }
    const rows = this.#db
      .select()
      .from(events)
      .where(and(...conditions))
      .orderBy(desc(events.rowId))
      .limit(query.limit + 1)
      .all();
    const page = rows.slice(0, query.limit);
    return {
      events: page.map(toEvent),
      nextCursor:
        rows.length > query.limit
          ? (page[page.length - 1]?.rowId ?? null)
          : null,
    };
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
