// SPDX-FileCopyrightText: 2026 Open Print Stack contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { type Capabilities, CommandKind } from "@openprintstack/protocol";

import type { SimulatedSettings } from "./settings.ts";

/** The extension behind the UI's Simulator panel. */
export const SIMULATOR_EXTENSION = "simulator";

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
        controllable: true,
        maxC: settings.nozzleMaxC,
      },
      {
        id: "bed",
        kind: "bed",
        label: "Bed",
        controllable: true,
        maxC: settings.bedMaxC,
      },
      // A sensor that warms with the bed, as a real enclosure's does, so the
      // UI has a heater it can show but not set.
      {
        id: "chamber",
        kind: "chamber",
        label: "Chamber",
        controllable: false,
        maxC: null,
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
