// SPDX-FileCopyrightText: 2026 Open Print Stack contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from "vitest";

import {
  isEcho,
  newClientId,
  newRequestId,
  parsePayload,
  topicsFor,
} from "./protocol.ts";

describe("topicsFor", () => {
  it("names one client's topics", () => {
    expect(topicsFor("SN1", "0cli12345a", "req1")).toEqual({
      register: "elegoo/SN1/api_register",
      registerResponse: "elegoo/SN1/req1/register_response",
      status: "elegoo/SN1/api_status",
      request: "elegoo/SN1/0cli12345a/api_request",
      response: "elegoo/SN1/0cli12345a/api_response",
    });
  });
});

describe("isEcho", () => {
  it.each([
    ["elegoo/SN1/1_PC_1234/api_request", true],
    ["elegoo/SN1/api_register", true],
    ["elegoo/SN1/api_status", false],
    ["elegoo/SN1/0cli12345a/api_response", false],
    ["elegoo/SN1/req1/register_response", false],
  ])("%s: %s", (topic, echo) => {
    expect(isEcho(topic)).toBe(echo);
  });
});

describe("newClientId", () => {
  it("is 0cli, five hex digits of the time and random hex, 10 long", () => {
    const id = newClientId(0x18f2a3b4c5d, () => 0.5);

    expect(id).toBe("0clib4c5d8");
    expect(id).toHaveLength(10);
  });

  it("stays 10 long whatever the time and randomness", () => {
    for (const [now, random] of [
      [0, 0],
      [1, 0.999_999],
      [Date.now(), Math.random()],
    ] as const) {
      expect(newClientId(now, () => random)).toMatch(/^0cli[0-9a-f]{6}$/);
    }
  });
});

describe("newRequestId", () => {
  it("is 16 random hex digits then the time in hex", () => {
    expect(newRequestId(0x18f2a3b4c5d, () => 0.75)).toBe(
      "cccccccccccccccc18f2a3b4c5d",
    );
  });
});

describe("parsePayload", () => {
  it("reads JSON from bytes or a string, and refuses anything else", () => {
    expect(parsePayload(new TextEncoder().encode('{"type":"PONG"}'))).toEqual({
      type: "PONG",
    });
    expect(parsePayload("[1]")).toEqual([1]);
    expect(parsePayload("not json")).toBeUndefined();
  });
});
