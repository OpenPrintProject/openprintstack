// SPDX-FileCopyrightText: 2026 Open Print Stack contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from "vitest";

import { Heater } from "./index.ts";

const base = { id: "chamber", kind: "chamber", label: "Chamber" } as const;

describe("Heater", () => {
  it("has a limit when it's settable", () => {
    const heater = { ...base, controllable: true, maxC: 60 };

    expect(Heater.parse(heater)).toStrictEqual(heater);
  });

  it("has no limit when it only reports its temperature", () => {
    const sensor = { ...base, controllable: false, maxC: null };

    expect(Heater.parse(sensor)).toStrictEqual(sensor);
  });

  it.each([
    ["a settable heater without a limit", { controllable: true, maxC: null }],
    ["a read-only heater with a limit", { controllable: false, maxC: 60 }],
    ["a heater that doesn't say", { maxC: 60 }],
    ["a limit that isn't a number", { controllable: true, maxC: "60" }],
  ])("refuses %s", (_name, change) => {
    expect(Heater.safeParse({ ...base, ...change }).success).toBe(false);
  });
});
