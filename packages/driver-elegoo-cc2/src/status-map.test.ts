// SPDX-FileCopyrightText: 2026 Open Print Stack contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { PrinterStatus } from "@openprintstack/protocol";
import { describe, expect, it } from "vitest";

import { describeException, exceptionCodes, mapStatus } from "./status-map.ts";

function machine(status: number, sub_status = 0, exception_status = []) {
  return { machine_status: { status, sub_status, exception_status } };
}

describe("mapStatus", () => {
  it.each<[number, PrinterStatus, string | null]>([
    [1045, "preparing", "Heating the nozzle"],
    [1096, "preparing", "Heating the nozzle"],
    [1405, "preparing", "Heating the bed"],
    [1906, "preparing", "Heating the bed"],
    [2801, "preparing", "Homing"],
    [2802, "preparing", "Homing"],
    [2901, "preparing", "Levelling the bed"],
    [2902, "preparing", "Levelling the bed"],
    [1081, "preparing", "Downloading the file"],
    [1082, "preparing", "Downloading the file"],
    [1086, "preparing", "Downloading the file"],
    [2075, "printing", null],
    [2401, "printing", "Resuming"],
    [2402, "printing", null],
    [2501, "pausing", null],
    [2502, "paused", null],
    [2505, "paused", null],
    [2503, "cancelling", null],
    [2077, "idle", null],
    [2504, "idle", null],
    [0, "printing", null],
    [1041, "printing", null],
    [9999, "printing", null],
  ])("printing with sub-status %i is %s (%s)", (sub, status, detail) => {
    expect(mapStatus(machine(2, sub))).toEqual({ status, detail, error: null });
  });

  it.each<[number, PrinterStatus, string | null]>([
    [0, "busy", "Starting up"],
    [1, "idle", null],
    [3, "busy", "Loading or unloading filament"],
    [4, "busy", "Loading or unloading filament"],
    [5, "busy", "Levelling the bed"],
    [6, "busy", "Calibrating the heaters"],
    [7, "busy", "Testing for resonance"],
    [8, "busy", "Running a self-check"],
    [9, "busy", "Updating its firmware"],
    [10, "busy", "Homing"],
    [11, "busy", "Receiving a file"],
    [12, "busy", "Making the timelapse video"],
    [13, "busy", "Loading or unloading the extruder"],
    [15, "busy", "Recovering from a power cut"],
    [16, "busy", "Busy (status 16)"],
  ])("machine status %i is %s (%s)", (code, status, detail) => {
    expect(mapStatus(machine(code))).toEqual({ status, detail, error: null });
  });

  it("is in error after an emergency stop", () => {
    expect(mapStatus(machine(14))).toEqual({
      status: "error",
      detail: null,
      error: {
        code: "emergency_stop",
        message: "Emergency stop. Check the printer, then restart it.",
      },
    });
  });

  it("is busy when the printer doesn't say", () => {
    expect(mapStatus({})).toEqual({
      status: "busy",
      detail: "Busy (status unknown)",
      error: null,
    });
  });

  it("keeps the status, and reports problem codes as its error", () => {
    const status = {
      machine_status: {
        status: 2,
        sub_status: 2502,
        exception_status: [109, 1026, 4242],
      },
    };

    expect(mapStatus(status)).toEqual({
      status: "paused",
      detail: null,
      error: {
        code: "printer_exception",
        message:
          "Filament ran out (109). No bed mesh: run auto levelling (1026). Printer problem 4242.",
      },
    });
  });

  it("adds problem codes to an emergency stop's message", () => {
    expect(
      mapStatus({ machine_status: { status: 14, exception_status: [109] } })
        .error,
    ).toEqual({
      code: "emergency_stop",
      message:
        "Emergency stop. Check the printer, then restart it. Filament ran out (109).",
    });
  });
});

describe("exceptionCodes", () => {
  it("reads whole numbers once each, in order", () => {
    expect(
      exceptionCodes({
        machine_status: { exception_status: [109, "x", 1.5, 109, 1026] },
      }),
    ).toEqual([109, 1026]);
  });

  it("is empty when there's no list", () => {
    expect(exceptionCodes({ machine_status: {} })).toEqual([]);
    expect(exceptionCodes({})).toEqual([]);
  });
});

describe("describeException", () => {
  it.each([
    [109, "Filament ran out (109)."],
    [1026, "No bed mesh: run auto levelling (1026)."],
    [7, "Printer problem 7."],
  ])("describes %i", (code, text) => {
    expect(describeException(code)).toBe(text);
  });
});
