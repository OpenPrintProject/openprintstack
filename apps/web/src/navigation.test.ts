// SPDX-FileCopyrightText: 2026 Open Print Stack contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from "vitest";

import { safeRedirect } from "./navigation.ts";

describe("safeRedirect", () => {
  it.each([
    ["/", "/"],
    ["/printers/abc", "/printers/abc"],
    ["/printers/abc?tab=files#top", "/printers/abc?tab=files#top"],
    ["/a/../b", "/b"],
  ])("keeps the in-app path %j", (target, path) => {
    expect(safeRedirect(target)).toBe(path);
  });

  it.each([
    undefined,
    "",
    "printers",
    "//evil.example/steal",
    "/\\evil.example",
    "\\\\evil.example",
    "https://evil.example/",
    "javascript:alert(1)",
    " /printers",
  ])("refuses %j for /", (target) => {
    expect(safeRedirect(target)).toBe("/");
  });
});
