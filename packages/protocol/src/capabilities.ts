// SPDX-FileCopyrightText: 2026 Open Print Stack contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { z } from "zod";

import { CommandKind } from "./commands.ts";
import { Id } from "./common.ts";

export const HeaterKind = z
  .enum(["nozzle", "bed", "chamber"])
  .meta({ id: "HeaterKind" });

export type HeaterKind = z.infer<typeof HeaterKind>;

export const Heater = z
  .object({
    /** The key for this heater in `Telemetry.temperatures`. */
    id: Id,
    kind: HeaterKind,
    label: z.string(),
    /** The highest target the server will send, in °C. */
    maxC: z.number(),
  })
  .meta({ id: "Heater" });

export type Heater = z.infer<typeof Heater>;

export const FanKind = z
  .enum(["part", "auxiliary", "chamber", "other"])
  .meta({ id: "FanKind" });

export type FanKind = z.infer<typeof FanKind>;

export const Fan = z
  .object({
    /** The key for this fan in `Telemetry.fans`. */
    id: Id,
    kind: FanKind,
    label: z.string(),
    /** Whether `fan.set` can change it, or it only reports its speed. */
    controllable: z.boolean(),
  })
  .meta({ id: "Fan" });

export type Fan = z.infer<typeof Fan>;

const AxisRange = z.object({ minMm: z.number(), maxMm: z.number() });

/**
 * What a printer can do. The UI hides any control the capabilities don't
 * include. Drivers may only know some of this after connecting.
 */
export const Capabilities = z
  .object({
    /** The command kinds the printer supports. */
    commands: z.array(CommandKind),
    heaters: z.array(Heater),
    fans: z.array(Fan),
    /** The build volume, or null if the printer doesn't report it. */
    axes: z
      .object({ x: AxisRange, y: AxisRange, z: AxisRange })
      .meta({ id: "BuildVolume" })
      .nullable(),
    maxMoveSpeedMmS: z.number().nullable(),
    files: z
      .object({
        list: z.boolean(),
        upload: z.boolean(),
        acceptedExtensions: z.array(z.string()),
        maxUploadBytes: z.number().nullable(),
      })
      .meta({ id: "FileCapabilities" }),
    cameras: z
      .object({
        snapshot: z.boolean(),
        /** Always false until Phase 2. */
        stream: z.boolean(),
      })
      .meta({ id: "CameraCapabilities" }),
    /** Driver-specific extensions, such as `simulator`. */
    extensions: z.array(z.string()),
  })
  .meta({ id: "Capabilities" });

export type Capabilities = z.infer<typeof Capabilities>;
