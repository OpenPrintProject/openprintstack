// SPDX-FileCopyrightText: 2026 Open Print Stack contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  EVENT_CATEGORY,
  type EventType,
  OpsEvent,
  type OpsEventOf,
} from "@openprintstack/protocol";

import { newId } from "../ids.ts";
import type { Logger } from "../logger.ts";
import type { StateStore } from "../state/store.ts";

// Every event in the server goes through here. publish() stamps the envelope,
// applies the event to the state store, then calls each subscriber in turn.
// An event published while another is being delivered waits until that one
// has reached every subscriber, so delivery order is publish order, overall
// and per printer.

/** The envelope fields the bus fills in. */
type Stamped = "id" | "ts" | "seq" | "bootId" | "category" | "correlationId";

/**
 * An event as a publisher writes it: everything except the envelope fields the
 * bus stamps. `correlationId` defaults to null.
 */
export type EventDraft<T extends EventType = EventType> = T extends EventType
  ? Omit<OpsEventOf<T>, Stamped> & { correlationId?: string | null }
  : never;

/**
 * Called once per event, in publish order. It must not change the event.
 * Anything it throws is logged, and the other subscribers still run.
 */
export type Subscriber = (event: OpsEvent) => void;

export type EventBusOptions = {
  store: Pick<StateStore, "apply">;
  logger: Logger;
  /**
   * Whether to Zod-check every event as it's published and deep-freeze it. On
   * by default; the server turns it off in production.
   */
  validate?: boolean;
  /** A new UUIDv7 by default. */
  bootId?: string;
  /** The time in milliseconds, for `ts`. `Date.now` by default. */
  now?: () => number;
};

type Subscription = {
  readonly name: string;
  readonly handler: Subscriber;
  active: boolean;
};

export class EventBus {
  /** Identifies this run of the server. Every event carries it. */
  readonly bootId: string;
  readonly #store: Pick<StateStore, "apply">;
  readonly #logger: Logger;
  readonly #validate: boolean;
  readonly #now: () => number;
  readonly #subscriptions = new Set<Subscription>();
  readonly #queue: OpsEvent[] = [];
  #seq = 0;
  #delivering = false;

  constructor(options: EventBusOptions) {
    this.bootId = options.bootId ?? newId();
    this.#store = options.store;
    this.#logger = options.logger.child({ component: "bus" });
    this.#validate = options.validate ?? true;
    this.#now = options.now ?? (() => Date.now());
  }

  /**
   * Stamps the event and delivers it: to the state store first, then to each
   * subscriber. Returns the stamped event. When called from a subscriber, the
   * event is delivered once the current one has reached every subscriber.
   *
   * With `validate` on, an invalid event throws a ZodError here and is never
   * numbered or delivered.
   */
  publish(draft: EventDraft): OpsEvent {
    const event = this.#stamp(draft);
    this.#queue.push(event);
    if (!this.#delivering) {
      this.#deliverQueue();
    }
    return event;
  }

  /**
   * Calls `handler` with every event published from now on, after any
   * subscribers added before it. `name` identifies it in logs. Returns a
   * function that unsubscribes it; after that it receives nothing more, even
   * if an event is being delivered.
   */
  subscribe(name: string, handler: Subscriber): () => void {
    const subscription: Subscription = { name, handler, active: true };
    this.#subscriptions.add(subscription);
    return () => {
      subscription.active = false;
      this.#subscriptions.delete(subscription);
    };
  }

  #stamp(draft: EventDraft): OpsEvent {
    const event = {
      id: newId(),
      ts: new Date(this.#now()).toISOString(),
      seq: this.#seq + 1,
      bootId: this.bootId,
      printerId: draft.printerId,
      type: draft.type,
      category: EVENT_CATEGORY[draft.type],
      source: draft.source,
      correlationId: draft.correlationId ?? null,
      payload: draft.payload,
    } as OpsEvent;
    if (this.#validate) {
      // Checked, not replaced by Zod's copy, so production (which skips this)
      // delivers exactly the same object.
      OpsEvent.parse(event);
      deepFreeze(event);
    }
    this.#seq = event.seq;
    return event;
  }

  #deliverQueue(): void {
    this.#delivering = true;
    try {
      let event: OpsEvent | undefined;
      while ((event = this.#queue.shift())) {
        this.#deliver(event);
      }
    } finally {
      this.#delivering = false;
    }
  }

  #deliver(event: OpsEvent): void {
    try {
      this.#store.apply(event);
    } catch (error) {
      this.#logger.error(
        { err: error, ...eventFields(event) },
        "The state store couldn't apply an event; delivered it anyway",
      );
    }
    // A copy, so a subscriber added during delivery starts with the next event.
    for (const subscription of [...this.#subscriptions]) {
      if (!subscription.active) continue;
      try {
        subscription.handler(event);
      } catch (error) {
        this.#logger.error(
          {
            err: error,
            subscriber: subscription.name,
            ...eventFields(event),
          },
          "A subscriber threw; delivered the event to the rest",
        );
      }
    }
  }
}

/** What logs say about an event: enough to find it, without its payload. */
export function eventFields(event: OpsEvent): {
  eventId: string;
  eventType: EventType;
  seq: number;
  printerId: string | null;
} {
  return {
    eventId: event.id,
    eventType: event.type,
    seq: event.seq,
    printerId: event.printerId,
  };
}

/** Events are plain JSON-like trees, so there are no cycles to guard against. */
function deepFreeze(value: unknown): void {
  if (typeof value !== "object" || value === null) {
    return;
  }
  Object.freeze(value);
  for (const child of Object.values(value)) {
    deepFreeze(child);
  }
}
