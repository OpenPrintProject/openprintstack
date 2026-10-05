// SPDX-FileCopyrightText: 2026 Open Print Stack contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { type Capabilities, CommandKind } from "@openprintstack/protocol";

import type { SimulatedSettings } from "./settings.ts";

/** The extension behind the UI's Simulator panel. */
export const SIMULATOR_EXTENSION = "simulator";

/** The chamber's limit. Not a setting, so the settings match the plan. */
export const CHAMBER_MAX_C = 60;

export const ACCEPTED_EXTENSIONS: readonly string[] = [".gcode", ".3mf"];

/** 1 GiB. */
export const MAX_UPLOAD_BYTES = 1024 ** 3;

export const CAMERA = { id: "main", label: "Simulated camera" } as const;

/** What the simulated printer can do. It never changes after connecting. */
export function simulatedCapabilities(
  settings: SimulatedSettings,
): Capabilities {
  return {
    commands: [...CommandKind.options],
    heaters: [
      {
        id: "nozzle",
        kind: "nozzle",
        label: "Nozzle",
        maxC: settings.nozzleMaxC,
      },
      { id: "bed", kind: "bed", label: "Bed", maxC: settings.bedMaxC },
      {
        id: "chamber",
        kind: "chamber",
        label: "Chamber",
        maxC: CHAMBER_MAX_C,
      },
    ],
    fans: [
      { id: "part", kind: "part", label: "Part cooling", controllable: true },
      // Runs by itself while the nozzle is hot, so the UI has a fan it can
      // show but not control.
      { id: "hotend", kind: "other", label: "Hotend", controllable: false },
    ],
    axes: {
      x: { minMm: 0, maxMm: settings.buildVolumeXMm },
      y: { minMm: 0, maxMm: settings.buildVolumeYMm },
      z: { minMm: 0, maxMm: settings.buildVolumeZMm },
    },
    maxMoveSpeedMmS: settings.maxMoveSpeedMmS,
    files: {
      list: true,
      upload: true,
      acceptedExtensions: [...ACCEPTED_EXTENSIONS],
      maxUploadBytes: MAX_UPLOAD_BYTES,
    },
    cameras: { snapshot: settings.cameraEnabled, stream: false },
    extensions: [SIMULATOR_EXTENSION],
  };
}
