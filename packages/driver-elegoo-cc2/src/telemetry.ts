// SPDX-FileCopyrightText: 2026 Open Print Stack contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import type {
  Axis,
  FanReading,
  JobProgress,
  Telemetry,
  TemperatureReading,
} from "@openprintstack/protocol";

import { FANS, HEATERS } from "./capabilities.ts";
import type { JsonObject } from "./protocol.ts";
import { numberAt, objectAt, stringAt } from "./read.ts";

// The printer's merged status as our telemetry. Anything it leaves out is
// null, which means "not reported", never 0.

/** `speed_mode` 0–3: Silent, Balanced, Sport and Ludicrous. */
const SPEED_PERCENT: readonly number[] = [50, 100, 150, 200];

/** The fans report a PWM value, 0–255 (to confirm on hardware). */
const FAN_FULL_SCALE = 255;

const AXES: readonly Axis[] = ["x", "y", "z"];

/** File names are never empty in our events. */
export const UNKNOWN_FILE = "Unknown file";

export type Readings = Omit<Telemetry, "job">;

export function readTelemetry(status: JsonObject): Readings {
  const temperatures: Record<string, TemperatureReading> = {};
  for (const { source, heater } of HEATERS) {
    const reading = objectAt(status, source);
    temperatures[heater.id] = {
      actualC: numberAt(reading, "temperature"),
      targetC: heater.controllable ? numberAt(reading, "target") : null,
    };
  }

  const reported = objectAt(status, "fans");
  const fans: Record<string, FanReading> = {};
  for (const { source, fan } of FANS) {
    const speed = numberAt(objectAt(reported, source), "speed");
    fans[fan.id] = {
      percent:
        speed === null ? null : Math.round((speed / FAN_FULL_SCALE) * 100),
    };
  }

  const move = objectAt(status, "gcode_move_inf");
  const x = numberAt(move, "x");
  const y = numberAt(move, "y");
  const z = numberAt(move, "z");
  const mode = numberAt(move, "speed_mode");
  const homed = objectAt(status, "toolhead").homed_axes;

  return {
    temperatures,
    fans,
    speedPercent: mode === null ? null : (SPEED_PERCENT[mode] ?? null),
    position: x === null || y === null || z === null ? null : { x, y, z },
    homedAxes:
      typeof homed === "string"
        ? AXES.filter((axis) => homed.toLowerCase().includes(axis))
        : null,
  };
}

/** The job as the printer reports it. */
export type PrintInfo = {
  readonly uuid: string | null;
  readonly fileName: string | null;
  /** From the status, or null when it's left out (or 0). */
  readonly totalLayers: number | null;
};

export function readPrint(status: JsonObject): PrintInfo {
  const print = objectAt(status, "print_status");
  const total = numberAt(print, "total_layer");
  return {
    uuid: stringAt(print, "uuid"),
    fileName: stringAt(print, "filename"),
    totalLayers: total === null || total <= 0 ? null : total,
  };
}

/**
 * The current job's progress. `totalLayers` fills in the layer count when the
 * status leaves it out (it comes from the file's details instead).
 */
export function readJob(
  status: JsonObject,
  totalLayers: number | null,
): JobProgress {
  const print = objectAt(status, "print_status");
  return {
    fileName: stringAt(print, "filename") ?? UNKNOWN_FILE,
    progressPercent:
      numberAt(print, "progress") ??
      numberAt(objectAt(status, "machine_status"), "progress"),
    elapsedS: numberAt(print, "print_duration"),
    remainingS: numberAt(print, "remaining_time_sec"),
    currentLayer: numberAt(print, "current_layer"),
    totalLayers: readPrint(status).totalLayers ?? totalLayers,
  };
}
