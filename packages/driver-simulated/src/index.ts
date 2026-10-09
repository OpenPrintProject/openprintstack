// SPDX-FileCopyrightText: 2026 Open Print Stack contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { defineDriver } from "@openprintstack/driver-sdk";

import { simulatedCapabilities } from "./capabilities.ts";
import { SimulatedDriver } from "./driver.ts";
import { simulatedSettingsSchema } from "./settings.ts";

/**
 * A printer that exists only in memory, for trying everything without
 * hardware. The server's registry loads this default export.
 */
const simulatedDriver = defineDriver({
  manifest: {
    type: "simulated",
    name: "Simulated printer",
    description:
      "A virtual printer for trying Open Print Stack without hardware, with faults you can inject.",
    setupHelp: [
      "There's nothing to switch on: the simulated printer runs inside this server.",
      "The access code is optional. Once saved, it's never shown again; leave it blank when editing to keep it.",
    ],
  },
  settingsSchema: simulatedSettingsSchema,
  initialCapabilities: simulatedCapabilities,
  create: (init, ctx) => new SimulatedDriver(init, ctx),
});

export default simulatedDriver;

export {
  ACCEPTED_EXTENSIONS,
  CAMERA,
  MAX_UPLOAD_BYTES,
  SIMULATOR_EXTENSION,
  simulatedCapabilities,
} from "./capabilities.ts";
export { TICK_MS } from "./driver.ts";
export { type SimulatorAction, SimulatorParams } from "./extension.ts";
export {
  AMBIENT_C,
  PRINT_TEMPERATURES_C,
  TOTAL_LAYERS,
  TRANSITION_S,
} from "./printer.ts";
export {
  type SimulatedSettings,
  simulatedSettingsSchema,
  SPEED_MULTIPLIER,
} from "./settings.ts";
