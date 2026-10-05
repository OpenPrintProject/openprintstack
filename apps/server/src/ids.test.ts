// SPDX-FileCopyrightText: 2026 Open Print Stack contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from "vitest";
import { z } from "zod";

import { newId } from "./ids.ts";

describe("newId", () => {
  it("makes UUIDv7s, which protocol's event envelope requires", () => {
    for (let i = 0; i < 100; i++) {
      expect(z.uuidv7().safeParse(newId()).success).toBe(true);
    }
  });

  it("makes a different id every time", () => {
    const ids = new Set(Array.from({ length: 1000 }, () => newId()));
    expect(ids.size).toBe(1000);
  });

  it("starts with the time in milliseconds", () => {
    const before = Date.now();
    const id = newId();
    const after = Date.now();

    const ms = Number.parseInt(id.replaceAll("-", "").slice(0, 12), 16);
    expect(ms).toBeGreaterThanOrEqual(before);
    expect(ms).toBeLessThanOrEqual(after);
  });
});
