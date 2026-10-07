// SPDX-FileCopyrightText: 2026 Open Print Stack contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from "vitest";

import {
  hasActiveJob,
  isOnline,
  JOB_STATUSES,
  ONLINE_STATUSES,
  PrinterStatus,
} from "./index.ts";

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

describe("isOnline", () => {
  it("is false only while offline or connecting", () => {
    const offline = PrinterStatus.options.filter((s) => !isOnline(s));

    expect(offline).toEqual(["connecting", "offline"]);
  });

  it("counts a printer in error as online", () => {
    expect(isOnline("error")).toBe(true);
    expect(ONLINE_STATUSES).toContain("error");
  });
});

describe("JOB_STATUSES", () => {
  it("is exactly the plan's five statuses", () => {
    expect([...JOB_STATUSES].sort()).toEqual(
      ["cancelling", "paused", "pausing", "preparing", "printing"].sort(),
    );
  });

  it("is what hasActiveJob checks", () => {
    const active = PrinterStatus.options.filter((s) => hasActiveJob(s));

    expect(active).toEqual(JOB_STATUSES);
  });
});
