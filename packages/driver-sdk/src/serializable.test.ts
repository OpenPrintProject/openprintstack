// SPDX-FileCopyrightText: 2026 Open Print Stack contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from "vitest";

import { assertSerializable, findUnserializable } from "./index.ts";

class Reading {
  actualC = 20;
}

const cyclic: Record<string, unknown> = { a: 1 };
cyclic.self = cyclic;

describe("findUnserializable", () => {
  it.each([
    ["a Date", { at: new Date(0) }, "message.at is a Date"],
    ["a Map", { m: new Map() }, "message.m is a Map"],
    ["a Set", { s: new Set() }, "message.s is a Set"],
    ["a function", { onDone: () => 1 }, "message.onDone is a function"],
    ["a symbol", { s: Symbol("x") }, "message.s is a symbol"],
    ["a bigint", { n: 1n }, "message.n is a bigint"],
    ["a class instance", { r: new Reading() }, "message.r is a Reading"],
    [
      "an ArrayBuffer",
      { b: new ArrayBuffer(1) },
      "message.b is an ArrayBuffer",
    ],
    [
      "another typed array",
      { b: new Int8Array(1) },
      "message.b is an Int8Array",
    ],
    ["an Error", { e: new Error("x") }, "message.e is an Error"],
    ["NaN", { n: Number.NaN }, "message.n is NaN, which JSON can't represent"],
    ["Infinity", { n: Infinity }, "message.n is Infinity"],
    [
      "undefined in an array",
      { list: [1, undefined] },
      "message.list[1] is undefined",
    ],
    ["undefined on its own", undefined, "message is undefined"],
    ["a cycle", cyclic, "message.self refers back to one of its parents"],
  ])("rejects %s", (_name, value, problem) => {
    expect(findUnserializable(value)).toContain(problem);
  });

  it("names the path to a nested value", () => {
    const message = {
      telemetry: { temperatures: { "tool 0": { actualC: new Date(0) } } },
      files: [{ name: "a" }, { name: () => "b" }],
    };

    expect(findUnserializable(message)).toBe(
      'message.telemetry.temperatures["tool 0"].actualC is a Date',
    );
    expect(findUnserializable(message.files, "files")).toBe(
      "files[1].name is a function",
    );
  });

  it.each([
    ["a string", "text"],
    ["a number", -1.5],
    ["a boolean", false],
    ["null", null],
    ["an empty object", {}],
    ["nested arrays and objects", { a: [{ b: [1, "2", null] }] }],
    ["undefined as a property", { detail: undefined }],
    ["a Uint8Array", { data: new Uint8Array([1, 2]) }],
    ["a Buffer, which is a Uint8Array", { data: Buffer.from("png") }],
    ["an object without a prototype", Object.create(null) as object],
    ["the same object twice, without a cycle", sharedTwice()],
  ])("accepts %s", (_name, value) => {
    expect(findUnserializable(value)).toBeNull();
  });
});

describe("assertSerializable", () => {
  it("throws a TypeError naming the problem", () => {
    expect(() => assertSerializable({ at: new Date(0) })).toThrow(
      new TypeError("Not serialisable: message.at is a Date."),
    );
  });
});

function sharedTwice() {
  const shared = { x: 1 };
  return { a: shared, b: [shared] };
}
