// SPDX-FileCopyrightText: 2026 Open Print Stack contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { z } from "zod";

/** The simulation speed range, shared by the setting and `set_speed`. */
export const SPEED_MULTIPLIER = { min: 0.1, max: 1000 } as const;

/** One build-volume axis, in mm. */
function buildVolumeAxis(axis: "X" | "Y" | "Z") {
  return z
    .number()
    .min(10)
    .max(2000)
    .default(256)
    .meta({
      title: `Build volume ${axis} (mm)`,
      description: `How far the toolhead can travel along ${axis}, from 0.`,
    });
}

/**
 * The simulated printer's settings. The UI renders them as a form, using each
 * field's title and description as its label and hint. The access code is
 * write-only, like a real printer's, so the server never shows it again.
 */
export const simulatedSettingsSchema = z.object({
  printDurationS: z.int().min(1).max(86_400).default(600).meta({
    title: "Print duration (s)",
    description:
      "How long every print takes, in simulated seconds, not counting heat-up.",
  }),
  speedMultiplier: z
    .number()
    .min(SPEED_MULTIPLIER.min)
    .max(SPEED_MULTIPLIER.max)
    .default(1)
    .meta({
      title: "Speed multiplier",
      description:
        "How fast simulated time runs. At 60, a simulated minute passes every second.",
    }),
  heatUpS: z.number().min(0).max(600).default(20).meta({
    title: "Heat-up time (s)",
    description:
      "Simulated seconds the nozzle and bed take to reach print temperature from 25 °C.",
  }),
  nozzleMaxC: z.number().min(100).max(500).default(300).meta({
    title: "Nozzle maximum (°C)",
    description: "The highest nozzle temperature the printer accepts.",
  }),
  bedMaxC: z.number().min(50).max(200).default(120).meta({
    title: "Bed maximum (°C)",
    description: "The highest bed temperature the printer accepts.",
  }),
  buildVolumeXMm: buildVolumeAxis("X"),
  buildVolumeYMm: buildVolumeAxis("Y"),
  buildVolumeZMm: buildVolumeAxis("Z"),
  maxMoveSpeedMmS: z.number().min(1).max(1000).default(200).meta({
    title: "Maximum move speed (mm/s)",
    description: "The fastest jog the printer accepts.",
  }),
  cameraEnabled: z.boolean().default(true).meta({
    title: "Camera",
    description: "Whether the printer has a camera that takes snapshots.",
  }),
  accessCode: z.string().max(64).optional().meta({
    title: "Access code",
    description:
      "Optional, and never checked: it shows how a real printer's access code is kept secret.",
    writeOnly: true,
  }),
});

export type SimulatedSettings = z.output<typeof simulatedSettingsSchema>;
