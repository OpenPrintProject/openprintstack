// SPDX-FileCopyrightText: 2026 Open Print Stack contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from "vitest";

import { PrinterName } from "./index.ts";

describe("PrinterName", () => {
  it("trims and NFC-normalises", () => {
    // "e" + combining acute accent becomes "é".
    expect(PrinterName.parse("  Café – Werkstatt  ")).toBe(
      "Café – Werkstatt",
    );
  });

  it.each([
    ["1 character", "a"],
    ["64 characters", "x".repeat(64)],
    ["64 emoji (128 UTF-16 units)", "🖨".repeat(64)],
  ])("accepts %s", (_, name) => {
    expect(PrinterName.parse(name)).toBe(name);
  });

  it.each([
    ["empty", "", "Must not be empty."],
    ["only spaces", "   ", "Must not be empty."],
    ["65 characters", "x".repeat(65), "Must be at most 64 characters."],
    ["a control character", "Bench\u0007", "Must not contain control characters."],
    ["a newline", "Bench\nTwo", "Must not contain control characters."],
  ])("refuses a name that's %s", (_, name, message) => {
    const result = PrinterName.safeParse(name);

    expect(result.error?.issues.map((issue) => issue.message)).toEqual([
      message,
    ]);
  });
});
