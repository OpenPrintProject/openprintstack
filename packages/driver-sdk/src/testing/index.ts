// SPDX-FileCopyrightText: 2026 Open Print Stack contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

// Test helpers for drivers. This entry point imports Vitest, so only tests
// may import it.

export {
  CONFORMANCE_CHECKS,
  type CheckContext,
  type ConformanceCheck,
  type ConformanceFixture,
} from "./checks.ts";
export { describeDriverConformance } from "./conformance.ts";
export {
  createDriverHarness,
  type DriverHarness,
  type DriverHarnessOptions,
} from "./harness.ts";
