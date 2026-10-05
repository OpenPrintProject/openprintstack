// SPDX-FileCopyrightText: 2026 Open Print Stack contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { z } from "zod";

import { Axis } from "./common.ts";

// Units: °C, mm, seconds and percent (0–100, except speed, which can go above
// 100). `null` means the printer doesn't report the value; it never means 0.
// These are driver readings, so values are not range-checked.

export const TemperatureReading = z
  .object({
    actualC: z.number().nullable(),
    targetC: z.number().nullable(),
  })
  .meta({ id: "TemperatureReading" });

export type TemperatureReading = z.infer<typeof TemperatureReading>;

export const FanReading = z
  .object({ percent: z.number().nullable() })
  .meta({ id: "FanReading" });

export type FanReading = z.infer<typeof FanReading>;

/** The toolhead position in mm. Null as a whole when it isn't known. */
export const Position = z
  .object({ x: z.number(), y: z.number(), z: z.number() })
  .meta({ id: "Position" });

export type Position = z.infer<typeof Position>;

export const JobProgress = z
  .object({
    fileName: z.string(),
    progressPercent: z.number().nullable(),
    elapsedS: z.number().nullable(),
    remainingS: z.number().nullable(),
    currentLayer: z.number().nullable(),
    totalLayers: z.number().nullable(),
  })
  .meta({ id: "JobProgress" });

export type JobProgress = z.infer<typeof JobProgress>;

/** A printer's live readings. Events always carry all of it, never a patch. */
export const Telemetry = z
  .object({
    /** Keyed by heater id from the capabilities. */
    temperatures: z.record(z.string(), TemperatureReading),
    /** Keyed by fan id from the capabilities. */
    fans: z.record(z.string(), FanReading),
    speedPercent: z.number().nullable(),
    position: Position.nullable(),
    homedAxes: z.array(Axis).nullable(),
    job: JobProgress.nullable(),
  })
  .meta({ id: "Telemetry" });

export type Telemetry = z.infer<typeof Telemetry>;

/** Telemetry with nothing reported, e.g. while a printer is offline. */
export function emptyTelemetry(): Telemetry {
  return {
    temperatures: {},
    fans: {},
    speedPercent: null,
    position: null,
    homedAxes: null,
    job: null,
  };
}
