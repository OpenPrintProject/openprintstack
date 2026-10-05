// SPDX-FileCopyrightText: 2026 Open Print Stack contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it } from "vitest";

import type { DriverModule, SettingsSchema } from "../contract.ts";
import { CONFORMANCE_CHECKS, type ConformanceFixture } from "./checks.ts";

/**
 * Registers one Vitest test per conformance check for a driver module. Every
 * check runs a fresh driver through the cloning loopback, as the host would.
 * Run it with real timers: some checks wait.
 *
 *     describeDriverConformance(simulated, { settings: { printDurationS: 5 } });
 */
export function describeDriverConformance<S extends SettingsSchema>(
  module: DriverModule<S>,
  fixture: ConformanceFixture<S>,
): void {
  const resolved = {
    settings: fixture.settings,
    timeoutMs: fixture.timeoutMs ?? 5000,
    quietPeriodMs: fixture.quietPeriodMs ?? 1000,
  };
  // A check makes at most four calls, then may wait out the quiet period.
  const timeout = 4 * resolved.timeoutMs + resolved.quietPeriodMs;

  describe(`driver conformance: ${module.manifest.type}`, () => {
    for (const check of CONFORMANCE_CHECKS) {
      it(check.name, { timeout }, async (context) => {
        await check.run({
          module,
          fixture: resolved,
          skip: (note) => context.skip(note),
        });
      });
    }
  });
}
