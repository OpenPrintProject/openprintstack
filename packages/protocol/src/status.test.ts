// SPDX-FileCopyrightText: 2026 Open Print Stack contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from "vitest";

import { PrinterStatus } from "./index.ts";

describe("PrinterStatus", () => {
  it("accepts every normalised status", () => {
    for (const status of PrinterStatus.options) {
      expect(PrinterStatus.parse(status)).toBe(status);
    }
  });

  it("rejects anything else", () => {
    expect(PrinterStatus.safeParse("complete").success).toBe(false);
  });
});
