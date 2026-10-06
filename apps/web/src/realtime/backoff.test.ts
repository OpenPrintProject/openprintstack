// SPDX-FileCopyrightText: 2026 Open Print Stack contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from "vitest";

import { backoffDelay } from "./backoff.ts";

describe("backoffDelay", () => {
  it.each([
    [0, 250, 500],
    [1, 500, 1000],
    [2, 1000, 2000],
    [3, 2000, 4000],
    [5, 8000, 16_000],
    [6, 15_000, 30_000],
    [7, 15_000, 30_000],
    [50, 15_000, 30_000],
    [5000, 15_000, 30_000],
  ] as const)(
    "waits between half and all of min(30 s, 0.5 s × 2^n) after %i failures",
    (failures, shortest, longest) => {
      expect(backoffDelay(failures, () => 0)).toBe(shortest);
      expect(backoffDelay(failures, () => 0.5)).toBe((shortest + longest) / 2);
      expect(backoffDelay(failures, () => 1)).toBe(longest);
    },
  );

  it("uses Math.random by default", () => {
    const delays = Array.from({ length: 50 }, () => backoffDelay(2));

    expect(Math.min(...delays)).toBeGreaterThanOrEqual(1000);
    expect(Math.max(...delays)).toBeLessThanOrEqual(2000);
    expect(new Set(delays).size).toBeGreaterThan(1);
  });
});
