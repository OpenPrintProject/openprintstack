// SPDX-FileCopyrightText: 2026 Open Print Stack contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { OpsEvent, OpsEventOf } from "@openprintstack/protocol";
import { describe, expectTypeOf, it } from "vitest";

import type { EventBus, EventDraft, Subscriber } from "./bus.ts";

declare const bus: EventBus;

describe("EventDraft", () => {
  it("leaves out every field the bus stamps", () => {
    expectTypeOf<keyof EventDraft>().toEqualTypeOf<
      "type" | "printerId" | "source" | "payload" | "correlationId"
    >();
  });

  it("makes correlationId optional", () => {
    expectTypeOf<Omit<EventDraft<"auth.logout">, "correlationId">>().toExtend<
      EventDraft<"auth.logout">
    >();
  });

  it("is one draft per event type", () => {
    expectTypeOf<EventDraft<"printer.alert">["payload"]>().toEqualTypeOf<
      OpsEventOf<"printer.alert">["payload"]
    >();
  });
});

describe("EventBus", () => {
  it("publishes a draft and returns the stamped event", () => {
    expectTypeOf<EventBus["publish"]>()
      .parameter(0)
      .toEqualTypeOf<EventDraft>();
    expectTypeOf<EventBus["publish"]>().returns.toEqualTypeOf<OpsEvent>();
  });

  it("accepts a well-formed draft, with or without a correlation id", () => {
    bus.publish({
      type: "system.stopping",
      printerId: null,
      source: { kind: "system" },
      payload: {},
    });
    bus.publish({
      type: "printer.files_changed",
      printerId: "p",
      source: { kind: "driver" },
      correlationId: null,
      payload: {},
    });
  });

  it("refuses stamped fields, a mismatched payload and the wrong printerId", () => {
    bus.publish({
      type: "printer.files_changed",
      printerId: "p",
      source: { kind: "driver" },
      payload: {},
      // @ts-expect-error The bus numbers events.
      seq: 1,
    });
    bus.publish({
      type: "printer.alert",
      printerId: "p",
      source: { kind: "driver" },
      // @ts-expect-error An alert's payload has a severity, code and message.
      payload: { fileName: "benchy.gcode" },
    });
    // @ts-expect-error System events aren't about a printer.
    bus.publish({
      type: "system.stopping",
      printerId: "p",
      source: { kind: "system" },
      payload: {},
    });
    // @ts-expect-error Printer events must name the printer.
    bus.publish({
      type: "printer.files_changed",
      printerId: null,
      source: { kind: "driver" },
      payload: {},
    });
  });

  it("gives subscribers OpsEvents and expects nothing back", () => {
    expectTypeOf<Subscriber>().parameter(0).toEqualTypeOf<OpsEvent>();
    expectTypeOf<Subscriber>().returns.toEqualTypeOf<void>();
    expectTypeOf<EventBus["subscribe"]>().returns.toEqualTypeOf<() => void>();
  });
});
