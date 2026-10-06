// SPDX-FileCopyrightText: 2026 Open Print Stack contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

// The server's OpenAPI spec is generated from these schemas with
// z.toJSONSchema, and names its components after each schema's
// `.meta({ id })`.

import { describe, expect, it } from "vitest";
import { z } from "zod";

import {
  ApiError,
  Camera,
  JsonValue,
  OpsEvent,
  PrinterCommand,
  PrinterFile,
  PrinterSnapshot,
  WsClientMessage,
  WsServerMessage,
} from "./index.ts";

describe("JSON Schema", () => {
  it("converts every top-level schema, with each id defined once", () => {
    const all = z.object({
      ApiError,
      Camera,
      OpsEvent,
      PrinterCommand,
      PrinterFile,
      PrinterSnapshot,
      WsClientMessage,
      WsServerMessage,
    });

    // z.toJSONSchema throws if two different schemas share an id.
    const definitions = Object.keys(z.toJSONSchema(all).$defs ?? {});

    expect(definitions).toEqual(
      expect.arrayContaining([
        "ApiError",
        "Camera",
        "Capabilities",
        "CommandKind",
        "EventType",
        "JsonValue",
        "MotionMoveCommand",
        "OpsEvent",
        "PrinterCommand",
        "PrinterFile",
        "PrinterSnapshot",
        "PrinterState",
        "PrinterStatus",
        "PrinterTelemetryEvent",
        "Telemetry",
        "Topic",
        "WsClientMessage",
        "WsServerMessage",
      ]),
    );
    // Every definition has a name: none is one of Zod's anonymous __schema0s.
    expect(definitions.filter((name) => name.startsWith("__"))).toEqual([]);
  });

  it("refers to JsonValue rather than copying it", () => {
    const schema = z.toJSONSchema(z.object({ ApiError, PrinterCommand }));
    const definitions = schema.$defs ?? {};

    expect(definitions.ApiError).toMatchObject({
      properties: {
        error: { properties: { details: { $ref: "#/$defs/JsonValue" } } },
      },
    });
    expect(definitions.ExtensionInvokeCommand).toMatchObject({
      properties: { params: { $ref: "#/$defs/JsonValue" } },
    });
    expect(definitions.JsonValue).toMatchObject({
      anyOf: expect.arrayContaining([
        { type: "array", items: { $ref: "#/$defs/JsonValue" } },
      ]) as unknown,
    });
  });
});

describe("JsonValue", () => {
  it.each([
    ["a string", "x"],
    ["a number", 1.5],
    ["a boolean", false],
    ["null", null],
    ["an array", [1, "a", null, [true]]],
    ["an object", { a: { b: [1, { c: null }] } }],
    ["an empty object", {}],
    ["Infinity", Infinity],
    ["NaN", NaN],
    ["undefined", undefined],
    ["a Date", new Date(0)],
    ["a function", () => 1],
    ["a Map", new Map()],
    ["a bigint", 1n],
    ["an object holding undefined", { a: undefined }],
  ] as const)("agrees with z.json() on %s", (_, value) => {
    expect(JsonValue.safeParse(value).success).toBe(
      z.json().safeParse(value).success,
    );
  });

  it("accepts JSON values and refuses others", () => {
    expect(JsonValue.safeParse({ a: [1, "b", null, true] }).success).toBe(true);
    expect(JsonValue.safeParse(Infinity).success).toBe(false);
    expect(JsonValue.safeParse(new Date(0)).success).toBe(false);
  });
});
