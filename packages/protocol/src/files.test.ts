// SPDX-FileCopyrightText: 2026 Open Print Stack contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from "vitest";

import { printerFileFixtures } from "./fixtures.ts";
import { Camera, PrinterFile } from "./index.ts";

describe("PrinterFile", () => {
  const [file] = printerFileFixtures;

  it.each([
    ["an empty name", { name: "" }],
    ["a Date for modifiedAt", { modifiedAt: new Date() }],
    ["a local time for modifiedAt", { modifiedAt: "2026-10-05T12:00:00" }],
    ["a missing size", { sizeBytes: undefined }],
  ])("rejects %s", (_name, change) => {
    expect(PrinterFile.safeParse({ ...file, ...change }).success).toBe(false);
  });

  it("doesn't range-check the size, since it is a driver reading", () => {
    expect(PrinterFile.safeParse({ ...file, sizeBytes: 1.5 }).success).toBe(
      true,
    );
  });
});

describe("Camera", () => {
  it("needs an id", () => {
    expect(Camera.safeParse({ id: "", label: "Chamber" }).success).toBe(false);
  });
});
