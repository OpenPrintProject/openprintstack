// SPDX-FileCopyrightText: 2026 Open Print Stack contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from "vitest";

import {
  formatBytes,
  formatDuration,
  formatMm,
  formatPercent,
  formatTemperature,
} from "./format.ts";

describe("formatDuration", () => {
  it.each([
    [0, "0 s"],
    [45, "45 s"],
    [59.6, "1 min 0 s"],
    [200, "3 min 20 s"],
    [3600, "1 h 0 min 0 s"],
    [3725, "1 h 2 min 5 s"],
    [90_000, "25 h 0 min 0 s"],
    [-3, "0 s"],
  ])("%d s reads %j", (seconds, expected) => {
    expect(formatDuration(seconds)).toBe(expected);
  });

  it("shows a dash when not reported, never 0", () => {
    expect(formatDuration(null)).toBe("—");
  });
});

describe("formatTemperature", () => {
  it.each([
    [214.6, "214.6 °C"],
    [215, "215 °C"],
    [59.84, "59.8 °C"],
    [0, "0 °C"],
    [null, "—"],
  ])("%j reads %j", (celsius, expected) => {
    expect(formatTemperature(celsius)).toBe(expected);
  });
});

describe("formatPercent", () => {
  it.each([
    [42.5, "43 %"],
    [0, "0 %"],
    [150, "150 %"],
    [null, "—"],
  ])("%j reads %j", (percent, expected) => {
    expect(formatPercent(percent)).toBe(expected);
  });
});

describe("formatMm", () => {
  it.each([
    [120.5, "120.5 mm"],
    [0, "0 mm"],
    [2.4, "2.4 mm"],
    [0.125, "0.13 mm"],
  ])("%d reads %j", (mm, expected) => {
    expect(formatMm(mm)).toBe(expected);
  });
});

describe("formatBytes", () => {
  it.each([
    [0, "0 B"],
    [999, "999 B"],
    [1000, "1 kB"],
    [1_234_567, "1.2 MB"],
    [1024 ** 3, "1.1 GB"],
    [null, "—"],
  ])("%j reads %j", (bytes, expected) => {
    expect(formatBytes(bytes)).toBe(expected);
  });
});
