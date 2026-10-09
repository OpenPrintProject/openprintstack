// SPDX-FileCopyrightText: 2026 Open Print Stack contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { Capabilities, Fan, Heater } from "@openprintstack/protocol";

// What a CC2 can do. The limits come from Elegoo's published specification
// (https://www.elegoo.com/products/centauri-carbon-2, "Specifications",
// checked 2026-10-09): "Max. Nozzle Temperature 350 °C", "Max. Heated Bed
// Temperature 110 °C (Ambient Temperature 25 °C)" and "Build Volume 256 ×
// 256 × 256 mm".

export const NOZZLE_MAX_C = 350;
export const BED_MAX_C = 110;
export const BUILD_VOLUME_MM = 256;

/** Our heaters, and the key each one has in the printer's status. */
export const HEATERS = [
  {
    source: "extruder",
    heater: {
      id: "nozzle",
      kind: "nozzle",
      label: "Nozzle",
      controllable: true,
      maxC: NOZZLE_MAX_C,
    },
  },
  {
    source: "heater_bed",
    heater: {
      id: "bed",
      kind: "bed",
      label: "Bed",
      controllable: true,
      maxC: BED_MAX_C,
    },
  },
  // A thermometer in the enclosure: it has no target.
  {
    source: "ztemperature_sensor",
    heater: {
      id: "chamber",
      kind: "chamber",
      label: "Chamber",
      controllable: false,
      maxC: null,
    },
  },
] as const satisfies readonly { source: string; heater: Heater }[];

/** Our fans, and the key each one has in the status's `fans`. */
export const FANS = [
  {
    source: "fan",
    fan: {
      id: "part",
      kind: "part",
      label: "Part cooling",
      controllable: true,
    },
  },
  {
    source: "aux_fan",
    fan: {
      id: "auxiliary",
      kind: "auxiliary",
      label: "Auxiliary",
      controllable: true,
    },
  },
  {
    source: "box_fan",
    fan: {
      id: "chamber",
      kind: "chamber",
      label: "Chamber exhaust",
      controllable: true,
    },
  },
  // These two run by themselves.
  {
    source: "heater_fan",
    fan: { id: "hotend", kind: "other", label: "Hotend", controllable: false },
  },
  {
    source: "controller_fan",
    fan: {
      id: "mainboard",
      kind: "other",
      label: "Mainboard",
      controllable: false,
    },
  },
] as const satisfies readonly { source: string; fan: Fan }[];

/** The only file type confirmed so far. */
export const ACCEPTED_EXTENSIONS: readonly string[] = [".gcode"];

/**
 * A CC2's capabilities. They don't depend on its settings, and never change
 * after connecting. Read-only for now: commands, files and the camera come
 * in later PRs.
 */
export function cc2Capabilities(): Capabilities {
  const axis = { minMm: 0, maxMm: BUILD_VOLUME_MM };
  return {
    commands: [],
    heaters: HEATERS.map(({ heater }) => ({ ...heater })),
    fans: FANS.map(({ fan }) => ({ ...fan })),
    axes: { x: { ...axis }, y: { ...axis }, z: { ...axis } },
    // The CC2's move command takes no speed.
    maxMoveSpeedMmS: null,
    files: {
      list: false,
      upload: false,
      acceptedExtensions: [...ACCEPTED_EXTENSIONS],
      maxUploadBytes: null,
    },
    cameras: { snapshot: false, stream: false },
    extensions: [],
  };
}
