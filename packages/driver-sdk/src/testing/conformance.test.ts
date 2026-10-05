// SPDX-FileCopyrightText: 2026 Open Print Stack contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

// The kit as a driver package uses it.

import { describe } from "vitest";

import { fakeDriver } from "../fake-driver.ts";
import { describeDriverConformance } from "./index.ts";

describeDriverConformance(fakeDriver, {
  settings: { tickMs: 10 },
  quietPeriodMs: 100,
});

describe("without cameras", () => {
  // The snapshot check is skipped rather than failed.
  describeDriverConformance(fakeDriver, {
    settings: { tickMs: 10, cameraEnabled: false },
    quietPeriodMs: 100,
  });
});
