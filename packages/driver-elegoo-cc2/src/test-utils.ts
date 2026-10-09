// SPDX-FileCopyrightText: 2026 Open Print Stack contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { setTimeout as sleep } from "node:timers/promises";

import type {
  DriverMessage,
  DriverMessageOf,
} from "@openprintstack/driver-sdk";
import type { DriverHarness } from "@openprintstack/driver-sdk/testing";

import type { Cc2Timings } from "./driver.ts";

/**
 * Short delays, so tests against the fake printer run quickly. The silence
 * limit leaves room for a slow CI runner's pauses.
 */
export const TEST_TIMINGS: Cc2Timings = {
  attemptMs: 2000,
  identifyMs: 400,
  identifyRetryMs: 100,
  connectMs: 1000,
  registerMs: 1000,
  requestMs: 1000,
  heartbeatMs: 100,
  silenceMs: 1500,
  backoffMs: [50, 100, 200],
};

/**
 * Waits until `check` returns something other than undefined or false, and
 * returns it. Fails after `timeoutMs`, describing what it waited for.
 */
export async function until<T>(
  what: string,
  check: () => T | undefined | false | Promise<T | undefined | false>,
  timeoutMs = 5000,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const result = await check();
    if (result !== undefined && result !== false) return result;
    if (Date.now() > deadline) {
      throw new Error(`Timed out waiting for ${what}.`);
    }
    await sleep(10);
  }
}

/** The messages of one type the driver has sent, in order. */
export function sent<T extends DriverMessage["type"]>(
  harness: DriverHarness,
  type: T,
): DriverMessageOf<T>[] {
  return harness.messages.filter(
    (message): message is DriverMessageOf<T> => message.type === type,
  );
}

/** The last status the driver sent. */
export function lastStatus(
  harness: DriverHarness,
): DriverMessageOf<"status"> | undefined {
  return sent(harness, "status").at(-1);
}
