// SPDX-FileCopyrightText: 2026 Open Print Stack contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from "vitest";

import { DriverError, toDriverError } from "./index.ts";

describe("DriverError", () => {
  it("is an Error with a code", () => {
    const error = new DriverError("offline", "The printer is offline.");

    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe("DriverError");
    expect(error.code).toBe("offline");
    expect(error.toInfo()).toEqual({
      code: "offline",
      message: "The printer is offline.",
    });
  });

  it("loses its code in structuredClone, which is why it crosses as info", () => {
    const clone = structuredClone(new DriverError("timeout", "Too slow."));

    expect(clone).not.toBeInstanceOf(DriverError);
    expect((clone as Partial<DriverError>).code).toBeUndefined();
  });
});

describe("toDriverError", () => {
  it("keeps a DriverError as it is", () => {
    const error = new DriverError("invalid_state", "Busy.");

    expect(toDriverError(error)).toBe(error);
  });

  it("wraps any other error as internal, keeping its message and cause", () => {
    const cause = new TypeError("x is undefined");
    const error = toDriverError(cause);

    expect(error.code).toBe("internal");
    expect(error.message).toBe("x is undefined");
    expect(error.cause).toBe(cause);
  });

  it("wraps a thrown non-error as internal", () => {
    const error = toDriverError("oops");

    expect(error.toInfo()).toEqual({
      code: "internal",
      message: "The driver threw a non-error.",
    });
    expect(error.cause).toBe("oops");
  });
});
