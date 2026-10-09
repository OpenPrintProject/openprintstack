// SPDX-FileCopyrightText: 2026 Open Print Stack contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from "vitest";

import {
  readJob,
  readPrint,
  readTelemetry,
  UNKNOWN_FILE,
} from "./telemetry.ts";
import { idleStatus } from "./testing/index.ts";

const printing = {
  machine_status: { status: 2, sub_status: 2075, progress: 44 },
  print_status: {
    filename: "benchy.gcode",
    uuid: "b52af24c-764e-4092-8a50-00e5f8f02b46",
    current_layer: 225,
    total_layer: 500,
    print_duration: 3600,
    total_duration: 8000,
    remaining_time_sec: 4400,
    progress: 45,
  },
  extruder: { temperature: 215, target: 220 },
  heater_bed: { temperature: 58.5, target: 60 },
  ztemperature_sensor: { temperature: 33 },
  fans: {
    fan: { speed: 255, rpm: 5000 },
    aux_fan: { speed: 178, rpm: 3500 },
    box_fan: { speed: 25, rpm: 800 },
    heater_fan: { speed: 255, rpm: 4500 },
    controller_fan: { speed: 128, rpm: 4000 },
  },
  gcode_move_inf: { x: 88.148, y: 139.946, z: 1.6, e: 138.87, speed_mode: 2 },
  toolhead: { homed_axes: "xyz" },
};

describe("readTelemetry", () => {
  it("reads every heater, fan, the speed, position and homed axes", () => {
    expect(readTelemetry(printing)).toEqual({
      temperatures: {
        nozzle: { actualC: 215, targetC: 220 },
        bed: { actualC: 58.5, targetC: 60 },
        chamber: { actualC: 33, targetC: null },
      },
      fans: {
        part: { percent: 100 },
        auxiliary: { percent: 70 },
        chamber: { percent: 10 },
        hotend: { percent: 100 },
        mainboard: { percent: 50 },
      },
      speedPercent: 150,
      position: { x: 88.148, y: 139.946, z: 1.6 },
      homedAxes: ["x", "y", "z"],
    });
  });

  it("never gives the chamber sensor a target", () => {
    const status = { ztemperature_sensor: { temperature: 30, target: 45 } };

    expect(readTelemetry(status).temperatures.chamber).toEqual({
      actualC: 30,
      targetC: null,
    });
  });

  it("reports what's missing as null", () => {
    expect(readTelemetry({})).toEqual({
      temperatures: {
        nozzle: { actualC: null, targetC: null },
        bed: { actualC: null, targetC: null },
        chamber: { actualC: null, targetC: null },
      },
      fans: {
        part: { percent: null },
        auxiliary: { percent: null },
        chamber: { percent: null },
        hotend: { percent: null },
        mainboard: { percent: null },
      },
      speedPercent: null,
      position: null,
      homedAxes: null,
    });
  });

  it.each([
    [0, 50],
    [1, 100],
    [2, 150],
    [3, 200],
    [4, null],
    [-1, null],
  ])("shows speed mode %i as %s %", (mode, percent) => {
    expect(
      readTelemetry({ gcode_move_inf: { speed_mode: mode } }).speedPercent,
    ).toBe(percent);
  });

  it.each([
    ["", []],
    ["x", ["x"]],
    ["xy", ["x", "y"]],
    ["zx", ["x", "z"]],
    ["XYZ", ["x", "y", "z"]],
  ])("reads homed axes %j", (homed, axes) => {
    expect(
      readTelemetry({ toolhead: { homed_axes: homed } }).homedAxes,
    ).toEqual(axes);
  });

  it("leaves out a position with a missing axis", () => {
    expect(
      readTelemetry({ gcode_move_inf: { x: 1, y: 2 } }).position,
    ).toBeNull();
  });

  it("reads an idle printer", () => {
    expect(readTelemetry(idleStatus())).toMatchObject({
      temperatures: { nozzle: { actualC: 26.4, targetC: 0 } },
      fans: { part: { percent: 0 }, mainboard: { percent: 100 } },
      speedPercent: 100,
      position: { x: 0, y: 0, z: 0 },
      homedAxes: [],
    });
  });
});

describe("readJob", () => {
  it("reads the print's progress", () => {
    expect(readJob(printing, null)).toEqual({
      fileName: "benchy.gcode",
      progressPercent: 45,
      elapsedS: 3600,
      remainingS: 4400,
      currentLayer: 225,
      totalLayers: 500,
    });
  });

  it("takes the layer count from elsewhere when the status leaves it out", () => {
    const status = {
      print_status: { ...printing.print_status, total_layer: 0 },
    };

    expect(readJob(status, 722).totalLayers).toBe(722);
    expect(readJob(status, null).totalLayers).toBeNull();
  });

  it("falls back to the machine's progress, and names an unnamed file", () => {
    expect(readJob({ machine_status: { progress: 12 } }, null)).toEqual({
      fileName: UNKNOWN_FILE,
      progressPercent: 12,
      elapsedS: null,
      remainingS: null,
      currentLayer: null,
      totalLayers: null,
    });
  });
});

describe("readPrint", () => {
  it("reads the uuid, the file and the layer count", () => {
    expect(readPrint(printing)).toEqual({
      uuid: "b52af24c-764e-4092-8a50-00e5f8f02b46",
      fileName: "benchy.gcode",
      totalLayers: 500,
    });
  });

  it("treats empty strings and 0 layers as not reported", () => {
    expect(readPrint(idleStatus())).toEqual({
      uuid: null,
      fileName: null,
      totalLayers: null,
    });
  });
});
