// SPDX-FileCopyrightText: 2026 Open Print Stack contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from "vitest";

import {
  errorCode,
  errorMessage,
  isRetryable,
  unexpectedResponse,
} from "./errors.ts";

const body = (code: string, message = "The server said so.") => ({
  error: { code, message },
});

describe("errorMessage", () => {
  it.each([
    ["an ApiError body", body("printer_busy"), "The server said so."],
    [
      "a failed fetch",
      new TypeError("Failed to fetch"),
      "Can't reach the server. Check that it's running, then try again.",
    ],
    ["anything else", new Error("boom"), "Something went wrong. Try again."],
    ["nothing", undefined, "Something went wrong. Try again."],
  ])("explains %s", (_, error, message) => {
    expect(errorMessage(error)).toBe(message);
  });
});

describe("errorCode", () => {
  it("is the ApiError body's code, if there is one", () => {
    expect(errorCode(body("setup_done"))).toBe("setup_done");
    expect(errorCode({ error: { message: "no code" } })).toBeUndefined();
    expect(errorCode(new TypeError("Failed to fetch"))).toBeUndefined();
  });
});

describe("isRetryable", () => {
  it.each([
    ["a failed fetch", new TypeError("Failed to fetch"), true],
    ["internal (500)", body("internal"), true],
    ["timeout (504)", body("timeout"), true],
    ["an empty 502", unexpectedResponse(502), true],
    ["an empty 500", unexpectedResponse(500), true],
    ["an unexplained 404", unexpectedResponse(404), false],
    ["unauthenticated (401)", body("unauthenticated"), false],
    ["setup_required (401)", body("setup_required"), false],
    ["printer_not_found (404)", body("printer_not_found"), false],
    ["printer_busy (409)", body("printer_busy"), false],
    ["validation_failed (400)", body("validation_failed"), false],
    ["anything else", new Error("boom"), false],
  ])("%s: %s", (_, error, retryable) => {
    expect(isRetryable(error)).toBe(retryable);
  });
});
