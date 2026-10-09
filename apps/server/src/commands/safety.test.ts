// SPDX-FileCopyrightText: 2026 Open Print Stack contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  type Capabilities,
  initialPrinterState,
  type PrinterCommand,
  type PrinterState,
  type Telemetry,
} from "@openprintstack/protocol";
import { capabilitiesFixture, TS } from "@openprintstack/protocol/fixtures";
import { describe, expect, it } from "vitest";

import { checkSafety } from "./safety.ts";

// The fixture printer: nozzle 0–300 °C, bed 0–120 °C, axes 0–256 mm,
// at most 200 mm/s, uploads up to 1000 bytes. Homed at 10/10/10.

const CAPABILITIES: Capabilities = {
  ...capabilitiesFixture,
  files: { ...capabilitiesFixture.files, maxUploadBytes: 1000 },
};

const HOMED: Partial<Telemetry> = {
  position: { x: 10, y: 10, z: 10 },
  homedAxes: ["x", "y", "z"],
};

function state(
  telemetry: Partial<Telemetry> = HOMED,
  capabilities: Partial<Capabilities> | null = {},
): PrinterState {
  const initial = initialPrinterState(TS);
  return {
    ...initial,
    status: "idle",
    telemetry: { ...initial.telemetry, ...telemetry },
    capabilities:
      capabilities === null ? null : { ...CAPABILITIES, ...capabilities },
  };
}

/** A command as an unparsed caller might send it, NaN and all. */
function command(value: Record<string, unknown>): PrinterCommand {
  return value as PrinterCommand;
}

type Case = [string, PrinterCommand, PrinterState, string | null];

function temperature(heaterId: string, targetC: number): PrinterCommand {
  return command({ kind: "temperature.set", heaterId, targetC });
}

function jog(move: Record<string, number>): PrinterCommand {
  return command({ kind: "motion.move", ...move });
}

function fan(percent: number): PrinterCommand {
  return command({ kind: "fan.set", fanId: "part", percent });
}

function upload(sizeBytes: number): PrinterCommand {
  return command({
    kind: "file.upload",
    stagedFileId: "0199b3a0-1c00-7000-8000-0000000000f1",
    fileName: "a.gcode",
    sizeBytes,
  });
}

const ABOVE_NOZZLE = (targetC: number) =>
  `${targetC} °C is above the Nozzle's 300 °C maximum.`;
const BELOW_ZERO = "The target must be 0 °C or more.";

describe("checkSafety: temperatures", () => {
  it.each<Case>([
    ["0 °C (off)", temperature("nozzle", 0), state(), null],
    ["exactly maxC", temperature("nozzle", 300), state(), null],
    ["maxC + 1", temperature("nozzle", 301), state(), ABOVE_NOZZLE(301)],
    [
      "just over maxC",
      temperature("nozzle", 300.1),
      state(),
      ABOVE_NOZZLE(300.1),
    ],
    [
      "the walkthrough's 400 °C",
      temperature("nozzle", 400),
      state(),
      ABOVE_NOZZLE(400),
    ],
    [
      "each heater's own maxC",
      temperature("bed", 121),
      state(),
      "121 °C is above the Bed's 120 °C maximum.",
    ],
    ["bed at its maxC", temperature("bed", 120), state(), null],
    ["below 0", temperature("nozzle", -1), state(), BELOW_ZERO],
    ["NaN", temperature("nozzle", NaN), state(), BELOW_ZERO],
    [
      "Infinity",
      temperature("nozzle", Infinity),
      state(),
      ABOVE_NOZZLE(Infinity),
    ],
    [
      "an unknown heater",
      temperature("chamber", 40),
      state(),
      'The printer has no heater "chamber", so its limit is unknown.',
    ],
    [
      "a heater that only reports its temperature",
      temperature("chamber", 0),
      state(HOMED, {
        heaters: [
          ...CAPABILITIES.heaters,
          {
            id: "chamber",
            kind: "chamber",
            label: "Chamber",
            controllable: false,
            maxC: null,
          },
        ],
      }),
      "The Chamber only reports its temperature, so it has no limit.",
    ],
    [
      "no capabilities",
      temperature("nozzle", 40),
      state(HOMED, null),
      'The printer has no heater "nozzle", so its limit is unknown.',
    ],
  ])("%s", (_, cmd, printer, message) => {
    expect(checkSafety(cmd, printer)).toEqual(
      message === null ? null : { code: "unsafe", message },
    );
  });
});

describe("checkSafety: fans", () => {
  const OUT_OF_RANGE = "A fan's speed must be from 0 to 100 %.";

  it.each<[number, string | null]>([
    [0, null],
    [55.5, null],
    [100, null],
    [100.5, OUT_OF_RANGE],
    [-1, OUT_OF_RANGE],
    [NaN, OUT_OF_RANGE],
  ])("%s %", (percent, message) => {
    expect(checkSafety(fan(percent), state())).toEqual(
      message === null ? null : { code: "unsafe", message },
    );
  });
});

describe("checkSafety: jogs", () => {
  const outside = (axis: string, to: number) =>
    `That jog would take ${axis} to ${to} mm, outside 0–256 mm.`;

  it.each<Case>([
    ["a small jog", jog({ x: 5 }), state(), null],
    ["to the minimum exactly", jog({ x: -10 }), state(), null],
    ["past the minimum", jog({ x: -10.001 }), state(), outside("x", -0.001)],
    ["to the maximum exactly", jog({ y: 246 }), state(), null],
    ["past the maximum", jog({ y: 246.1 }), state(), outside("y", 256.1)],
    ["far past it", jog({ z: 300 }), state(), outside("z", 310)],
    [
      "one axis of several out of bounds",
      jog({ x: 5, y: 5, z: -20 }),
      state(),
      outside("z", -10),
    ],
    [
      // 0.1 + 0.2 is 0.30000000000000004 in floating point.
      "to an edge despite floating point (0.1 + 0.2 to 0.3)",
      jog({ x: 0.2 }),
      state(
        { ...HOMED, position: { x: 0.1, y: 0, z: 0 } },
        {
          axes: {
            x: { minMm: 0, maxMm: 0.3 },
            y: { minMm: 0, maxMm: 256 },
            z: { minMm: 0, maxMm: 256 },
          },
        },
      ),
      null,
    ],
    [
      "before homing",
      jog({ x: 5 }),
      state({ position: null, homedAxes: [] }),
      "Home x before jogging.",
    ],
    [
      "before homing, several axes",
      jog({ x: 5, y: 5, z: 5 }),
      state({ position: null, homedAxes: null }),
      "Home x, y and z before jogging.",
    ],
    [
      "an unhomed axis among homed ones",
      jog({ x: 5, z: 1 }),
      state({ ...HOMED, homedAxes: ["x", "y"] }),
      "Home z before jogging.",
    ],
    [
      "a homed axis while another isn't",
      jog({ x: 5 }),
      state({ ...HOMED, homedAxes: ["x"] }),
      null,
    ],
    [
      "homed but with no known position",
      jog({ x: 5 }),
      state({ position: null, homedAxes: ["x", "y", "z"] }),
      "Home the printer before jogging: its position isn't known.",
    ],
    [
      "without a build volume",
      jog({ x: 5 }),
      state(HOMED, { axes: null }),
      "The printer doesn't report its build volume, so jogs are refused.",
    ],
    ["at the maximum speed", jog({ x: 5, speedMmS: 200 }), state(), null],
    [
      "too fast",
      jog({ x: 5, speedMmS: 200.5 }),
      state(),
      "200.5 mm/s is faster than the printer's 200 mm/s maximum.",
    ],
    [
      "a zero speed",
      jog({ x: 5, speedMmS: 0 }),
      state(),
      "A jog's speed must be more than 0 mm/s.",
    ],
    [
      "a NaN speed",
      jog({ x: 5, speedMmS: NaN }),
      state(),
      "A jog's speed must be more than 0 mm/s.",
    ],
    [
      "a speed with no maximum known",
      jog({ x: 5, speedMmS: 10 }),
      state(HOMED, { maxMoveSpeedMmS: null }),
      "The printer doesn't report a maximum speed, so a jog can't set one.",
    ],
    [
      "no speed and no maximum known",
      jog({ x: 5 }),
      state(HOMED, { maxMoveSpeedMmS: null }),
      null,
    ],
    ["no axes", jog({}), state(), "A jog needs at least one of x, y or z."],
    [
      "a NaN distance",
      jog({ x: NaN }),
      state(),
      "A jog's distances must be numbers.",
    ],
    [
      "an infinite distance",
      jog({ y: -Infinity }),
      state(),
      "A jog's distances must be numbers.",
    ],
  ])("%s", (_, cmd, printer, message) => {
    expect(checkSafety(cmd, printer)).toEqual(
      message === null ? null : { code: "unsafe", message },
    );
  });
});

describe("checkSafety: uploads", () => {
  it.each<[string, PrinterCommand, PrinterState, object | null]>([
    ["at the limit", upload(1000), state(), null],
    [
      "over the limit",
      upload(1001),
      state(),
      {
        code: "file_too_large",
        message: "The file is 1001 bytes; the printer takes at most 1000.",
      },
    ],
    [
      "any size without a limit",
      upload(2 ** 40),
      state(HOMED, { files: { ...CAPABILITIES.files, maxUploadBytes: null } }),
      null,
    ],
    [
      "a negative size",
      upload(-1),
      state(),
      {
        code: "unsafe",
        message: "A file's size must be a whole number of bytes.",
      },
    ],
    [
      "a fractional size",
      upload(1.5),
      state(),
      {
        code: "unsafe",
        message: "A file's size must be a whole number of bytes.",
      },
    ],
  ])("%s", (_, cmd, printer, expected) => {
    expect(checkSafety(cmd, printer)).toEqual(expected);
  });
});

describe("checkSafety: other commands", () => {
  it.each<PrinterCommand>([
    { kind: "print.start", fileName: "a.gcode" },
    { kind: "print.pause" },
    { kind: "print.resume" },
    { kind: "print.cancel" },
    { kind: "motion.home", axes: [] },
    {
      kind: "extension.invoke",
      extension: "simulator",
      action: "clear",
      params: null,
    },
  ])("has no limits for $kind", (cmd) => {
    expect(checkSafety(cmd, state({}, null))).toBeNull();
  });
});
