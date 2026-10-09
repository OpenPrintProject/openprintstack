// SPDX-FileCopyrightText: 2026 Open Print Stack contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { components } from "../api/schema.gen.ts";

// What the server sends for the simulated driver type (GET /api/driver-types),
// written out: the web app can't import driver packages.

/** The simulated printer's settings JSON Schema, as Zod writes it. */
export const SIMULATED_SETTINGS_SCHEMA = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  type: "object",
  properties: {
    printDurationS: {
      default: 600,
      title: "Print duration (s)",
      description:
        "How long every print takes, in simulated seconds, not counting heat-up.",
      type: "integer",
      minimum: 1,
      maximum: 86400,
    },
    speedMultiplier: {
      default: 1,
      title: "Speed multiplier",
      description:
        "How fast simulated time runs. At 60, a simulated minute passes every second.",
      type: "number",
      minimum: 0.1,
      maximum: 1000,
    },
    heatUpS: {
      default: 20,
      title: "Heat-up time (s)",
      description:
        "Simulated seconds the nozzle and bed take to reach print temperature from 25 °C.",
      type: "number",
      minimum: 0,
      maximum: 600,
    },
    nozzleMaxC: {
      default: 300,
      title: "Nozzle maximum (°C)",
      description: "The highest nozzle temperature the printer accepts.",
      type: "number",
      minimum: 100,
      maximum: 500,
    },
    bedMaxC: {
      default: 120,
      title: "Bed maximum (°C)",
      description: "The highest bed temperature the printer accepts.",
      type: "number",
      minimum: 50,
      maximum: 200,
    },
    buildVolumeXMm: {
      default: 256,
      title: "Build volume X (mm)",
      description: "How far the toolhead can travel along X, from 0.",
      type: "number",
      minimum: 10,
      maximum: 2000,
    },
    buildVolumeYMm: {
      default: 256,
      title: "Build volume Y (mm)",
      description: "How far the toolhead can travel along Y, from 0.",
      type: "number",
      minimum: 10,
      maximum: 2000,
    },
    buildVolumeZMm: {
      default: 256,
      title: "Build volume Z (mm)",
      description: "How far the toolhead can travel along Z, from 0.",
      type: "number",
      minimum: 10,
      maximum: 2000,
    },
    maxMoveSpeedMmS: {
      default: 200,
      title: "Maximum move speed (mm/s)",
      description: "The fastest jog the printer accepts.",
      type: "number",
      minimum: 1,
      maximum: 1000,
    },
    cameraEnabled: {
      default: true,
      title: "Camera",
      description: "Whether the printer has a camera that takes snapshots.",
      type: "boolean",
    },
    filamentSlots: {
      default: false,
      title: "Filament slots",
      description:
        "Whether the printer reports a filament changer with 4 slots, as a CANVAS or an AMS does.",
      type: "boolean",
    },
    accessCode: {
      title: "Access code",
      description:
        "Optional, and never checked: it shows how a real printer's access code is kept secret.",
      writeOnly: true,
      type: "string",
      maxLength: 64,
    },
  },
} as const;

/** The simulated printer's setup help. */
export const SIMULATED_SETUP_HELP = [
  "There's nothing to switch on: the simulated printer runs inside this server.",
  "The access code is optional. Once saved, it's never shown again; leave it blank when editing to keep it.",
];

/** The simulated printer's defaults, as the server lists them. */
export const SIMULATED_DEFAULTS = {
  printDurationS: 600,
  speedMultiplier: 1,
  heatUpS: 20,
  nozzleMaxC: 300,
  bedMaxC: 120,
  buildVolumeXMm: 256,
  buildVolumeYMm: 256,
  buildVolumeZMm: 256,
  maxMoveSpeedMmS: 200,
  cameraEnabled: true,
  filamentSlots: false,
} as const;

export const SIMULATED_DRIVER_TYPE: components["schemas"]["DriverType"] = {
  type: "simulated",
  name: "Simulated printer",
  description:
    "A virtual printer for trying Open Print Stack without hardware, with faults you can inject.",
  setupHelp: SIMULATED_SETUP_HELP,
  settingsSchema: SIMULATED_SETTINGS_SCHEMA,
  defaults: SIMULATED_DEFAULTS,
};
