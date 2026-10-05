// SPDX-FileCopyrightText: 2026 Open Print Stack contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it, vi } from "vitest";

import { dispatch, DriverError, type PrinterDriver } from "./index.ts";

/** A driver with only the given methods. */
function driverWith(methods: Record<string, unknown>): PrinterDriver {
  return methods as unknown as PrinterDriver;
}

const listed = {
  files: [{ name: "benchy.gcode", sizeBytes: 10, modifiedAt: null }],
};

describe("dispatch", () => {
  it("calls the op's method with the args and answers its result", async () => {
    const listFiles = vi.fn(() => Promise.resolve(listed));
    const setFan = vi.fn(() => Promise.resolve());
    const driver = driverWith({ listFiles, setFan });

    expect(
      await dispatch(driver, { id: 1, op: "listFiles", args: {} }),
    ).toEqual({ type: "response", id: 1, ok: true, result: listed });
    expect(
      await dispatch(driver, {
        id: 2,
        op: "setFan",
        args: { fanId: "part", percent: 50 },
      }),
    ).toEqual({ type: "response", id: 2, ok: true, result: null });
    expect(setFan).toHaveBeenCalledWith({ fanId: "part", percent: 50 });
  });

  it("answers null for an op that resolves with nothing, whatever it returns", async () => {
    const driver = driverWith({ pause: () => Promise.resolve("ignored") });

    expect(await dispatch(driver, { id: 1, op: "pause", args: {} })).toEqual({
      type: "response",
      id: 1,
      ok: true,
      result: null,
    });
  });

  it("answers an unknown op with not_supported", async () => {
    expect(
      await dispatch(driverWith({}), { id: 7, op: "explode", args: {} }),
    ).toEqual({
      type: "response",
      id: 7,
      ok: false,
      error: { code: "not_supported", message: 'Unknown op "explode".' },
    });
  });

  it.each(["toString", "constructor", "__proto__", "hasOwnProperty"])(
    "never reaches Object.prototype through op %s",
    async (op) => {
      const response = await dispatch(driverWith({}), { id: 1, op, args: {} });

      expect(response).toMatchObject({
        ok: false,
        error: { code: "not_supported" },
      });
    },
  );

  it("answers not_supported when the driver has no invokeExtension", async () => {
    const response = await dispatch(driverWith({}), {
      id: 1,
      op: "invokeExtension",
      args: { extension: "simulator", action: "clear", params: null },
    });

    expect(response).toEqual({
      type: "response",
      id: 1,
      ok: false,
      error: {
        code: "not_supported",
        message: 'This driver has no "invokeExtension".',
      },
    });
  });

  it("answers a DriverError with its code", async () => {
    const driver = driverWith({
      pause: () =>
        Promise.reject(new DriverError("invalid_state", "Nothing to pause.")),
    });

    expect(await dispatch(driver, { id: 1, op: "pause", args: {} })).toEqual({
      type: "response",
      id: 1,
      ok: false,
      error: { code: "invalid_state", message: "Nothing to pause." },
    });
  });

  it("answers any other failure as internal, even a synchronous throw", async () => {
    const driver = driverWith({
      pause: () => {
        throw new TypeError("x is undefined");
      },
    });

    expect(await dispatch(driver, { id: 1, op: "pause", args: {} })).toEqual({
      type: "response",
      id: 1,
      ok: false,
      error: { code: "internal", message: "x is undefined" },
    });
  });
});
