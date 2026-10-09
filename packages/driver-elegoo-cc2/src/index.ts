// SPDX-FileCopyrightText: 2026 Open Print Stack contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { defineDriver, type DriverModule } from "@openprintstack/driver-sdk";

import { cc2Capabilities } from "./capabilities.ts";
import {
  CC2_PORTS,
  CC2_TIMINGS,
  Cc2Driver,
  type Cc2Ports,
  type Cc2Timings,
} from "./driver.ts";
import { cc2SettingsSchema } from "./settings.ts";

export type Cc2DriverOptions = {
  /** The printer's ports. Default: MQTT 1883, UDP 52700. */
  readonly ports?: Partial<Cc2Ports>;
  /** The driver's delays. Default: `CC2_TIMINGS`. */
  readonly timings?: Partial<Cc2Timings>;
};

/**
 * The CC2 driver module, with other ports or timings. Tests use it to reach a
 * fake printer on loopback; the server registers the default export, which
 * uses the real ones.
 */
export function createElegooCc2Driver(
  options: Cc2DriverOptions = {},
): DriverModule<typeof cc2SettingsSchema> {
  const ports = { ...CC2_PORTS, ...options.ports };
  const timings = { ...CC2_TIMINGS, ...options.timings };
  return defineDriver({
    manifest: {
      type: "elegoo-cc2",
      name: "Elegoo Centauri Carbon 2",
      description:
        "Connects to an Elegoo Centauri Carbon 2 on your network, through its LAN Only mode and access code.",
      setupHelp: [
        "On the printer's screen, open the network settings and turn on LAN Only mode. This disconnects the printer from Elegoo's cloud and the Elegoo Matrix app.",
        "In the same place, set an access code and note it down.",
        "Enter the printer's IP address and the access code below. A fixed address (a DHCP reservation in your router) keeps the printer from moving.",
        "The printer accepts about 4 connections at once, shared with ElegooSlicer and its web page. If it reports too many, close one of them.",
      ],
    },
    settingsSchema: cc2SettingsSchema,
    initialCapabilities: () => cc2Capabilities(),
    create: (init, ctx) => new Cc2Driver(init, ctx, ports, timings),
  });
}

/**
 * The Elegoo Centauri Carbon 2, on firmware v02.01.00.00. The server's
 * registry loads this default export.
 */
const elegooCc2Driver = createElegooCc2Driver();

export default elegooCc2Driver;

export {
  ACCEPTED_EXTENSIONS,
  BED_MAX_C,
  BUILD_VOLUME_MM,
  cc2Capabilities,
  FANS,
  HEATERS,
  NOZZLE_MAX_C,
} from "./capabilities.ts";
export {
  CC2_PORTS,
  CC2_TIMINGS,
  type Cc2Ports,
  type Cc2Timings,
  JOBS_FILE,
  OFFLINE_ERRORS,
} from "./driver.ts";
export { type Cc2Settings, cc2SettingsSchema } from "./settings.ts";
