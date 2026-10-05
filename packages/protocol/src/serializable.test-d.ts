// SPDX-FileCopyrightText: 2026 Open Print Stack contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

// Type tests: Vitest runs these through tsc (see vitest.config.ts).

import { describe, expectTypeOf, it } from "vitest";

import type {
  ApiError,
  Capabilities,
  CommandKind,
  EventType,
  OpsEvent,
  OpsEventOf,
  PrinterCommand,
  PrinterSnapshot,
  PrinterState,
  Serializable,
  Telemetry,
  Topic,
  WsClientMessage,
  WsServerMessage,
  WsSnapshotOf,
} from "./index.ts";

describe("Serializable", () => {
  it("accepts every message, event and command", () => {
    // A union extends Serializable only if every member does, so these cover
    // each event type, command kind and message type.
    expectTypeOf<OpsEvent>().toExtend<Serializable>();
    expectTypeOf<PrinterCommand>().toExtend<Serializable>();
    expectTypeOf<WsClientMessage>().toExtend<Serializable>();
    expectTypeOf<WsServerMessage>().toExtend<Serializable>();
    expectTypeOf<ApiError>().toExtend<Serializable>();
  });

  it("accepts the state types", () => {
    expectTypeOf<PrinterSnapshot>().toExtend<Serializable>();
    expectTypeOf<PrinterState>().toExtend<Serializable>();
    expectTypeOf<Capabilities>().toExtend<Serializable>();
    expectTypeOf<Telemetry>().toExtend<Serializable>();
  });

  it("accepts primitives, null, arrays, plain objects and Uint8Array", () => {
    expectTypeOf<string>().toExtend<Serializable>();
    expectTypeOf<number>().toExtend<Serializable>();
    expectTypeOf<boolean>().toExtend<Serializable>();
    expectTypeOf<null>().toExtend<Serializable>();
    expectTypeOf<number[]>().toExtend<Serializable>();
    expectTypeOf<{ a: { b: string[] }; c?: number }>().toExtend<Serializable>();
    expectTypeOf<Uint8Array>().toExtend<Serializable>();
    expectTypeOf<{ png: Uint8Array }>().toExtend<Serializable>();
  });

  it("rejects Date, Map, Set, functions, bigint and undefined", () => {
    expectTypeOf<Date>().not.toExtend<Serializable>();
    expectTypeOf<{ at: Date }>().not.toExtend<Serializable>();
    expectTypeOf<Map<string, number>>().not.toExtend<Serializable>();
    expectTypeOf<Set<string>>().not.toExtend<Serializable>();
    expectTypeOf<() => void>().not.toExtend<Serializable>();
    expectTypeOf<{ onDone: () => void }>().not.toExtend<Serializable>();
    expectTypeOf<bigint>().not.toExtend<Serializable>();
    expectTypeOf<undefined>().not.toExtend<Serializable>();
    expectTypeOf<ArrayBuffer>().not.toExtend<Serializable>();
  });
});

describe("timestamps", () => {
  it("are ISO strings, never Date", () => {
    expectTypeOf<OpsEvent["ts"]>().toEqualTypeOf<string>();
    expectTypeOf<PrinterState["updatedAt"]>().toEqualTypeOf<string>();
  });
});

describe("unions", () => {
  it("cover every command kind", () => {
    expectTypeOf<PrinterCommand["kind"]>().toEqualTypeOf<CommandKind>();
  });

  it("cover every event type", () => {
    expectTypeOf<OpsEvent["type"]>().toEqualTypeOf<EventType>();
  });

  it("narrow an event's payload by type", () => {
    expectTypeOf<
      OpsEventOf<"command.result">["payload"]["ok"]
    >().toEqualTypeOf<boolean>();
    expectTypeOf<
      OpsEventOf<"printer.telemetry">["category"]
    >().toEqualTypeOf<"telemetry">();
    expectTypeOf<
      OpsEventOf<"printer.telemetry">["printerId"]
    >().toEqualTypeOf<string>();
    expectTypeOf<
      OpsEventOf<"system.started">["printerId"]
    >().toEqualTypeOf<null>();
  });

  it("give each snapshot topic its own data type", () => {
    expectTypeOf<WsSnapshotOf<"fleet">["data"]>().toEqualTypeOf<
      PrinterSnapshot[]
    >();
    expectTypeOf<
      WsSnapshotOf<"printer">["data"]
    >().toEqualTypeOf<PrinterSnapshot>();
    expectTypeOf<WsSnapshotOf<"events">["data"]>().toEqualTypeOf<null>();
    expectTypeOf<Topic["name"]>().toEqualTypeOf<
      "fleet" | "printer" | "events"
    >();
  });
});
