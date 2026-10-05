// SPDX-FileCopyrightText: 2026 Open Print Stack contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

// The driver-sdk conformance kit, on real timers: it waits out a quiet period
// after dispose, longer than a tick, to catch anything still running.

import { describeDriverConformance } from "@openprintstack/driver-sdk/testing";
import { describe } from "vitest";

import { TICK_MS } from "./driver.ts";
import simulatedDriver from "./index.ts";

const quietPeriodMs = TICK_MS + 200;

describeDriverConformance(simulatedDriver, { settings: {}, quietPeriodMs });

describe("without a camera", () => {
  // The snapshot check is skipped rather than failed.
  describeDriverConformance(simulatedDriver, {
    settings: { cameraEnabled: false },
    quietPeriodMs,
  });
});
