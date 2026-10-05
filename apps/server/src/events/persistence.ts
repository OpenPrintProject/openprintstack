// SPDX-FileCopyrightText: 2026 Open Print Stack contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  isOnline,
  type OpsEvent,
  type OpsEventOf,
} from "@openprintstack/protocol";
import Database from "better-sqlite3";

import { type EventBus, eventFields } from "../bus/bus.ts";
import type { EventsRepo } from "../db/repos/index.ts";
import type { Logger } from "../logger.ts";

// Writes every event to the database. Events wait in a queue that is written
// in one transaction per setImmediate tick, in the order they were queued.
//
// Telemetry is throttled per printer. A write opens a window of
// `sampleIntervalMs`; updates inside it replace one held value, which is
// written when the window ends (opening the next window). If nothing was
// held, the window closes and the next update is written straight away. A
// printer's held value is written at once, before the triggering event, when
// it stops being online or is removed, and when persistence closes.
//
// So rows are in seq order, except a held value written when its window ends:
// its row follows any events published since it was held.

export type EventPersistenceOptions = {
  bus: Pick<EventBus, "subscribe">;
  events: Pick<EventsRepo, "insertMany">;
  logger: Logger;
  /** Telemetry is written at most this often per printer; 0 writes every update. */
  sampleIntervalMs: number;
};

type TelemetryWindow = {
  readonly timer: NodeJS.Timeout;
  /** The newest update since the window opened, written when it ends. */
  held: OpsEventOf<"printer.telemetry"> | null;
};

export class EventPersistence {
  readonly #events: Pick<EventsRepo, "insertMany">;
  readonly #logger: Logger;
  readonly #sampleIntervalMs: number;
  readonly #unsubscribe: () => void;
  /** Open telemetry windows, by printer id. */
  readonly #windows = new Map<string, TelemetryWindow>();
  #queue: OpsEvent[] = [];
  #immediate: NodeJS.Immediate | null = null;

  constructor(options: EventPersistenceOptions) {
    this.#events = options.events;
    this.#logger = options.logger.child({ component: "persistence" });
    this.#sampleIntervalMs = options.sampleIntervalMs;
    this.#unsubscribe = options.bus.subscribe("persistence", (event) => {
      this.#receive(event);
    });
  }

  /**
   * Stops listening to the bus and writes everything still waiting, held
   * telemetry included, before it returns. Events published afterwards are
   * not stored, so call this after the last event and before closing the
   * database.
   */
  close(): void {
    this.#unsubscribe();
    for (const printerId of [...this.#windows.keys()]) {
      this.#endWindow(printerId);
    }
    if (this.#immediate) {
      clearImmediate(this.#immediate);
      this.#immediate = null;
    }
    this.#write();
  }

  #receive(event: OpsEvent): void {
    if (event.type === "printer.telemetry") {
      this.#throttle(event);
      return;
    }
    if (endsTelemetry(event)) {
      this.#endWindow(event.printerId);
    }
    this.#enqueue(event);
  }

  #throttle(event: OpsEventOf<"printer.telemetry">): void {
    if (this.#sampleIntervalMs === 0) {
      this.#enqueue(event);
      return;
    }
    const window = this.#windows.get(event.printerId);
    if (window) {
      window.held = event;
      return;
    }
    this.#enqueue(event);
    this.#openWindow(event.printerId);
  }

  #openWindow(printerId: string): void {
    const timer = setTimeout(() => {
      const window = this.#windows.get(printerId);
      this.#windows.delete(printerId);
      if (window?.held) {
        this.#enqueue(window.held);
        this.#openWindow(printerId);
      }
    }, this.#sampleIntervalMs);
    this.#windows.set(printerId, { timer, held: null });
  }

  /** Queues the printer's held telemetry, if any, and closes its window. */
  #endWindow(printerId: string): void {
    const window = this.#windows.get(printerId);
    if (!window) return;
    clearTimeout(window.timer);
    this.#windows.delete(printerId);
    if (window.held) {
      this.#enqueue(window.held);
    }
  }

  #enqueue(event: OpsEvent): void {
    this.#queue.push(event);
    this.#immediate ??= setImmediate(() => {
      this.#immediate = null;
      this.#write();
    });
  }

  #write(): void {
    const batch = this.#queue;
    if (batch.length === 0) return;
    this.#queue = [];
    try {
      this.#events.insertMany(batch);
    } catch (error) {
      if (isDatabaseFailure(error)) {
        this.#dropped(error, batch);
        return;
      }
      this.#logger.warn(
        { err: error, events: batch.length },
        "Couldn't write a batch of events; writing them one at a time",
      );
      this.#writeEach(batch);
    }
  }

  /** Writes events one by one, so one bad event loses only itself. */
  #writeEach(batch: readonly OpsEvent[]): void {
    for (const [index, event] of batch.entries()) {
      try {
        this.#events.insertMany([event]);
      } catch (error) {
        if (isDatabaseFailure(error)) {
          this.#dropped(error, batch.slice(index));
          return;
        }
        this.#logger.error(
          { err: error, ...eventFields(event) },
          "Couldn't write an event; dropped it",
        );
      }
    }
  }

  #dropped(error: unknown, events: readonly OpsEvent[]): void {
    this.#logger.error(
      {
        err: error,
        events: events.length,
        firstSeq: events[0]?.seq,
        lastSeq: events.at(-1)?.seq,
      },
      "The database couldn't write events; dropped them",
    );
  }
}

/** Whether the event means the printer's telemetry is about to be cleared. */
function endsTelemetry(
  event: OpsEvent,
): event is OpsEventOf<"printer.status_changed" | "printer.removed"> {
  return (
    event.type === "printer.removed" ||
    (event.type === "printer.status_changed" && !isOnline(event.payload.status))
  );
}

/**
 * Whether the database itself failed (busy, full, an I/O error...) rather
 * than one event being refused (a Zod or ts check, or a constraint such as a
 * duplicate id). Retrying event by event would fail the same way, and each
 * retry of a busy database waits out its 5 s busy timeout.
 */
function isDatabaseFailure(error: unknown): boolean {
  return (
    error instanceof Database.SqliteError &&
    !error.code.startsWith("SQLITE_CONSTRAINT")
  );
}
