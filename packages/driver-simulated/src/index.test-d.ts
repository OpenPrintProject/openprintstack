// SPDX-FileCopyrightText: 2026 Open Print Stack contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { DriverModule } from "@openprintstack/driver-sdk";
import type { Capabilities, Serializable } from "@openprintstack/protocol";
import { describe, expectTypeOf, it } from "vitest";

import simulatedDriver, {
  type SimulatedSettings,
  type simulatedSettingsSchema,
  SimulatorParams,
} from "./index.ts";

describe("the simulated driver module", () => {
  it("is a DriverModule over its settings schema", () => {
    expectTypeOf(simulatedDriver).toExtend<
      DriverModule<typeof simulatedSettingsSchema>
    >();
    type InitialCapabilities = (typeof simulatedDriver)["initialCapabilities"];
    expectTypeOf<InitialCapabilities>()
      .parameter(0)
      .toEqualTypeOf<SimulatedSettings>();
    expectTypeOf<InitialCapabilities>().returns.toEqualTypeOf<Capabilities>();
  });

  it("has settings that cross a worker boundary", () => {
    expectTypeOf<SimulatedSettings>().toExtend<Serializable>();
    expectTypeOf<SimulatedSettings>().toEqualTypeOf<{
      printDurationS: number;
      speedMultiplier: number;
      heatUpS: number;
      nozzleMaxC: number;
      bedMaxC: number;
      buildVolumeXMm: number;
      buildVolumeYMm: number;
      buildVolumeZMm: number;
      maxMoveSpeedMmS: number;
      cameraEnabled: boolean;
    }>();
  });

  it("names exactly the plan's simulator actions", () => {
    expectTypeOf<keyof typeof SimulatorParams>().toEqualTypeOf<
      | "fault.error"
      | "fault.filament_runout"
      | "fault.disconnect"
      | "clear"
      | "set_speed"
    >();
  });
});
