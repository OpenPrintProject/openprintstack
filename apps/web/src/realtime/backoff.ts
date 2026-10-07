// SPDX-FileCopyrightText: 2026 Open Print Stack contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

/** The first reconnect waits about this long, and each failure doubles it. */
export const BACKOFF_BASE_MS = 500;

/** The longest wait between reconnect attempts. */
export const BACKOFF_CAP_MS = 30_000;

/**
 * How long to wait before reconnect attempt `failures` (0 for the first, after
 * a connection drops): min(30 s, 0.5 s × 2^failures), times a random 0.5–1 so
 * that several tabs don't all retry at the same moment. That's 0.25–0.5 s,
 * then 0.5–1 s, 1–2 s, … up to 15–30 s.
 */
export function backoffDelay(
  failures: number,
  random: () => number = Math.random,
): number {
  const ceiling = Math.min(BACKOFF_CAP_MS, BACKOFF_BASE_MS * 2 ** failures);
  return ceiling * (0.5 + 0.5 * random());
}
