// SPDX-FileCopyrightText: 2026 Open Print Stack contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  EventType,
  type OpsEvent,
  type PrinterStatus,
} from "@openprintstack/protocol";
import {
  BOOT_ID,
  COMMAND_ID,
  eventFixtures,
  PRINTER_ID,
  TS,
  telemetryFixture,
} from "@openprintstack/protocol/fixtures";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { StateStore } from "../state/store.ts";
import { debugLogger, draftOf, jsonLines } from "../test-utils.ts";
import { type EventBusOptions, type EventDraft, EventBus } from "./bus.ts";

const driver = { kind: "driver" } as const;

/** An alert whose code names it, so tests can follow it through the bus. */
function alert(code: string, printerId = PRINTER_ID): EventDraft {
  return {
    type: "printer.alert",
    printerId,
    source: driver,
    payload: { severity: "info", code, message: "" },
  };
}

function status(to: PrinterStatus): EventDraft {
  return {
    type: "printer.status_changed",
    printerId: PRINTER_ID,
    source: driver,
    payload: { previous: null, status: to, detail: null, error: null },
  };
}

/** An alert's code, or the event's type for anything else. */
function label(event: OpsEvent): string {
  return event.type === "printer.alert" ? event.payload.code : event.type;
}

const invalid = {
  ...alert("bad"),
  payload: { severity: "panic", code: "bad", message: "" },
} as unknown as EventDraft;

async function setup(options: Partial<EventBusOptions> = {}) {
  const { logger, output } = await debugLogger();
  const store = new StateStore({
    lookupPrinter: () => ({ name: "Sim 1", driverType: "simulated" }),
    logger,
  });
  const bus = new EventBus({
    store,
    logger,
    bootId: BOOT_ID,
    now: () => Date.parse(TS),
    ...options,
  });
  return { bus, store, output };
}

function isDeepFrozen(value: unknown): boolean {
  if (typeof value !== "object" || value === null) return true;
  return Object.isFrozen(value) && Object.values(value).every(isDeepFrozen);
}

describe("EventBus.publish", () => {
  it("stamps the envelope and returns the event", async () => {
    const { bus } = await setup();

    const event = bus.publish(status("connecting"));

    const { id, ...rest } = event;
    expect(z.uuidv7().safeParse(id).success).toBe(true);
    expect(rest).toEqual({
      ts: TS,
      seq: 1,
      bootId: BOOT_ID,
      printerId: PRINTER_ID,
      type: "printer.status_changed",
      category: "state",
      source: driver,
      correlationId: null,
      payload: {
        previous: null,
        status: "connecting",
        detail: null,
        error: null,
      },
    });
  });

  it("stamps every event type as the fixtures expect", async () => {
    const { bus } = await setup();

    const fixtures = Object.values(eventFixtures);
    expect(fixtures.map((event) => event.type).sort()).toEqual(
      [...EventType.options].sort(),
    );
    for (const fixture of fixtures) {
      const event = bus.publish(draftOf(fixture));
      expect(event, fixture.type).toEqual({
        ...fixture,
        id: event.id,
        seq: event.seq,
      });
    }
  });

  it("keeps a correlation id", async () => {
    const { bus } = await setup();
    const { correlationId, ...draft } = draftOf(
      eventFixtures["command.requested"],
    );

    expect(correlationId).toBe(COMMAND_ID);
    expect(bus.publish({ ...draft, correlationId }).correlationId).toBe(
      COMMAND_ID,
    );
    expect(bus.publish(draft).correlationId).toBeNull();
  });

  it("numbers events from 1, in publish order", async () => {
    const { bus } = await setup();

    const seqs = ["a", "b", "c"].map((code) => bus.publish(alert(code)).seq);

    expect(seqs).toEqual([1, 2, 3]);
  });

  it("gives each event a new id", async () => {
    const { bus } = await setup();

    const ids = new Set(
      ["a", "b", "c"].map((code) => bus.publish(alert(code)).id),
    );

    expect(ids.size).toBe(3);
  });

  it("reads the clock for each event", async () => {
    let now = Date.parse("2026-10-05T12:00:00.000Z");
    const { bus } = await setup({ now: () => now });

    const first = bus.publish(alert("a"));
    now += 1234;
    const second = bus.publish(alert("b"));

    expect(first.ts).toBe("2026-10-05T12:00:00.000Z");
    expect(second.ts).toBe("2026-10-05T12:00:01.234Z");
  });

  it("uses Date.now when no clock is given", async () => {
    vi.useFakeTimers({ now: Date.parse("2026-10-05T09:30:00.250Z") });
    try {
      const { bus } = await setup({ now: undefined });

      expect(bus.publish(alert("a")).ts).toBe("2026-10-05T09:30:00.250Z");
    } finally {
      vi.useRealTimers();
    }
  });

  it("makes a new UUIDv7 boot id when none is given", async () => {
    const first = (await setup({ bootId: undefined })).bus;
    const second = (await setup({ bootId: undefined })).bus;

    expect(z.uuidv7().safeParse(first.bootId).success).toBe(true);
    expect(first.bootId).not.toBe(second.bootId);
    expect(first.publish(alert("a")).bootId).toBe(first.bootId);
  });
});

describe("delivery", () => {
  it("delivers every event to every subscriber, in the order they subscribed", async () => {
    const { bus } = await setup();
    const seen: string[] = [];
    bus.subscribe("a", (event) => seen.push(`a:${label(event)}`));
    bus.subscribe("b", (event) => seen.push(`b:${label(event)}`));

    bus.publish(alert("one"));
    bus.publish(alert("two"));

    expect(seen).toEqual(["a:one", "b:one", "a:two", "b:two"]);
  });

  it("delivers the published object itself", async () => {
    const { bus } = await setup();
    const seen: OpsEvent[] = [];
    bus.subscribe("a", (event) => seen.push(event));

    const event = bus.publish(alert("one"));

    expect(seen[0]).toBe(event);
  });

  it("applies each event to the store before any subscriber sees it", async () => {
    const order: string[] = [];
    const { bus } = await setup({
      store: { apply: (event) => order.push(`store:${event.seq}`) },
    });
    bus.subscribe("a", (event) => order.push(`a:${event.seq}`));
    bus.subscribe("b", (event) => order.push(`b:${event.seq}`));

    bus.publish(alert("one"));
    bus.publish(alert("two"));

    expect(order).toEqual(["store:1", "a:1", "b:1", "store:2", "a:2", "b:2"]);
  });

  it("lets subscribers read the state the event produced", async () => {
    const { bus, store } = await setup();
    const seen: unknown[] = [];
    bus.subscribe("a", (event) =>
      seen.push({
        seq: event.seq,
        storeSeq: store.seq,
        status: store.get(PRINTER_ID)?.state.status,
      }),
    );

    bus.publish(status("connecting"));
    bus.publish(status("idle"));

    expect(seen).toEqual([
      { seq: 1, storeSeq: 1, status: "connecting" },
      { seq: 2, storeSeq: 2, status: "idle" },
    ]);
  });

  it("delivers an event published during delivery after the current one has reached every subscriber", async () => {
    const { bus } = await setup();
    const seen: string[] = [];
    bus.subscribe("a", (event) => {
      seen.push(`a:${label(event)}`);
      if (label(event) === "parent") bus.publish(alert("child"));
    });
    bus.subscribe("b", (event) => seen.push(`b:${label(event)}`));

    bus.publish(alert("parent"));

    expect(seen).toEqual(["a:parent", "b:parent", "a:child", "b:child"]);
  });

  it("delivers events published during delivery first in, first out, at any depth", async () => {
    const { bus } = await setup();
    const seen: string[] = [];
    bus.subscribe("a", (event) => {
      seen.push(`${label(event)}#${event.seq}`);
      if (label(event) === "parent") {
        bus.publish(alert("child1"));
        bus.publish(alert("child2"));
      }
      if (label(event) === "child1") bus.publish(alert("grandchild"));
    });
    bus.subscribe("b", (event) => {
      if (label(event) === "parent") bus.publish(alert("child3"));
    });

    bus.publish(alert("parent"));

    expect(seen).toEqual([
      "parent#1",
      "child1#2",
      "child2#3",
      "child3#4",
      "grandchild#5",
    ]);
  });

  it("applies events published during delivery to the store in delivery order too", async () => {
    const order: string[] = [];
    const { bus } = await setup({
      store: { apply: (event) => order.push(`store:${label(event)}`) },
    });
    bus.subscribe("a", (event) => {
      order.push(`a:${label(event)}`);
      if (label(event) === "parent") bus.publish(alert("child"));
    });
    bus.subscribe("b", (event) => order.push(`b:${label(event)}`));

    bus.publish(alert("parent"));

    expect(order).toEqual([
      "store:parent",
      "a:parent",
      "b:parent",
      "store:child",
      "a:child",
      "b:child",
    ]);
  });

  it("returns an event published during delivery at once, stamped, and delivers that object later", async () => {
    const { bus } = await setup();
    let queued: OpsEvent | undefined;
    let seenByBWhenQueued: string[] = [];
    const seenByB: OpsEvent[] = [];
    bus.subscribe("a", (event) => {
      if (label(event) !== "parent") return;
      queued = bus.publish(alert("child"));
      seenByBWhenQueued = seenByB.map(label);
    });
    bus.subscribe("b", (event) => seenByB.push(event));

    bus.publish(alert("parent"));

    expect(queued?.seq).toBe(2);
    expect(seenByBWhenQueued).toEqual([]);
    expect(seenByB[1]).toBe(queued);
  });

  it("stops delivering to a subscriber once it unsubscribes", async () => {
    const { bus } = await setup();
    const seen: string[] = [];
    const unsubscribe = bus.subscribe("a", (event) => seen.push(label(event)));

    bus.publish(alert("one"));
    unsubscribe();
    unsubscribe();
    bus.publish(alert("two"));

    expect(seen).toEqual(["one"]);
  });

  it("delivers nothing more to a subscriber removed during delivery, not even the current event", async () => {
    const { bus } = await setup();
    const seen: string[] = [];
    let unsubscribeB = () => {};
    bus.subscribe("a", () => unsubscribeB());
    unsubscribeB = bus.subscribe("b", (event) => seen.push(label(event)));

    bus.publish(alert("one"));
    bus.publish(alert("two"));

    expect(seen).toEqual([]);
  });

  it("starts a subscriber added during delivery with the next event", async () => {
    const { bus } = await setup();
    const seen: string[] = [];
    bus.subscribe("a", (event) => {
      if (label(event) === "one") {
        bus.subscribe("late", (later) => seen.push(label(later)));
      }
    });

    bus.publish(alert("one"));
    bus.publish(alert("two"));

    expect(seen).toEqual(["two"]);
  });
});

describe("a subscriber that throws", () => {
  it("doesn't stop the others, stays subscribed, and is logged without the payload", async () => {
    const { bus, output } = await setup();
    const seen: string[] = [];
    bus.subscribe("a", (event) => {
      seen.push(`a:${label(event)}`);
      throw new Error("boom");
    });
    bus.subscribe("b", (event) => seen.push(`b:${label(event)}`));

    const event = bus.publish(alert("one"));
    bus.publish(alert("two"));

    expect(seen).toEqual(["a:one", "b:one", "a:two", "b:two"]);
    const errors = jsonLines(output).filter((line) => line.level === "error");
    expect(errors).toHaveLength(2);
    expect(errors[0]).toMatchObject({
      component: "bus",
      subscriber: "a",
      eventId: event.id,
      eventType: "printer.alert",
      seq: 1,
      printerId: PRINTER_ID,
      msg: "A subscriber threw; delivered the event to the rest",
    });
    expect(errors[0]!.err).toMatchObject({ type: "Error", message: "boom" });
    expect(errors[0]).not.toHaveProperty("payload");
  });

  it("logs an invalid event published by a subscriber against that subscriber", async () => {
    const { bus, output } = await setup();
    const seen: string[] = [];
    bus.subscribe("a", (event) => {
      if (label(event) === "parent") bus.publish(invalid);
    });
    bus.subscribe("b", (event) => seen.push(label(event)));

    bus.publish(alert("parent"));

    expect(seen).toEqual(["parent"]);
    const [error] = jsonLines(output).filter((line) => line.level === "error");
    expect(error).toMatchObject({ subscriber: "a", seq: 1 });
    expect(error!.err).toMatchObject({ type: "ZodError" });
    // The invalid event used no seq.
    expect(bus.publish(alert("next")).seq).toBe(2);
  });

  it("is handled the same way when it's the state store", async () => {
    const { bus, output } = await setup({
      store: {
        apply() {
          throw new Error("store broke");
        },
      },
    });
    const seen: string[] = [];
    bus.subscribe("a", (event) => seen.push(label(event)));

    const event = bus.publish(alert("one"));

    expect(seen).toEqual(["one"]);
    const [error] = jsonLines(output).filter((line) => line.level === "error");
    expect(error).toMatchObject({
      component: "bus",
      eventId: event.id,
      seq: 1,
      msg: "The state store couldn't apply an event; delivered it anyway",
    });
    expect(error!.err).toMatchObject({ message: "store broke" });
    expect(error).not.toHaveProperty("subscriber");
  });
});

describe("validation", () => {
  it("throws for an invalid event, without numbering or delivering it", async () => {
    const { bus, store } = await setup();
    const seen: string[] = [];
    bus.subscribe("a", (event) => seen.push(label(event)));

    expect(() => bus.publish(invalid)).toThrow(z.ZodError);

    expect(seen).toEqual([]);
    expect(store.seq).toBe(0);
    expect(bus.publish(alert("next")).seq).toBe(1);
  });

  it("freezes each event, including the payload object the publisher passed in", async () => {
    const { bus } = await setup();
    const payload = { telemetry: structuredClone(telemetryFixture) };

    const event = bus.publish({
      type: "printer.telemetry",
      printerId: PRINTER_ID,
      source: driver,
      payload,
    });

    expect(event.payload).toBe(payload);
    expect(isDeepFrozen(event)).toBe(true);
    expect(() => {
      payload.telemetry.speedPercent = 100;
    }).toThrow(TypeError);
  });

  it("with validation off (production), delivers what it's given and freezes nothing", async () => {
    const { bus } = await setup({ validate: false });
    const seen: OpsEvent[] = [];
    bus.subscribe("a", (event) => seen.push(event));

    const event = bus.publish(invalid);

    expect(seen).toEqual([event]);
    expect(event.seq).toBe(1);
    expect(Object.isFrozen(event)).toBe(false);
  });
});
