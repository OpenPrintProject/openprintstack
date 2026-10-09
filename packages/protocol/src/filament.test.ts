// SPDX-FileCopyrightText: 2026 Open Print Stack contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from "vitest";

import { filamentFixture } from "./fixtures.ts";
import { Filament, type FilamentSlot, type FilamentUnit } from "./index.ts";

const [unit] = filamentFixture.units as [FilamentUnit];
const [slot] = unit.slots as [FilamentSlot];

/** The readout with one unit holding these slots. */
function withSlots(...slots: unknown[]): unknown {
  return { units: [{ ...unit, slots }] };
}

/** Each issue's message, or [] if the readout is valid. */
function problems(readout: unknown): string[] {
  return (
    Filament.safeParse(readout).error?.issues.map((issue) => issue.message) ??
    []
  );
}

describe("Filament", () => {
  it("accepts a printer with nothing attached", () => {
    expect(Filament.parse({ units: [] })).toStrictEqual({ units: [] });
  });

  it("accepts a slot that reports nothing but its status", () => {
    const empty = {
      id: "1",
      label: "Slot 1",
      status: "empty",
      material: null,
      name: null,
      colorHex: null,
      nozzleMinC: null,
      nozzleMaxC: null,
    };

    expect(problems(withSlots(empty))).toEqual([]);
  });

  it.each([
    ["the same unit id twice", { units: [unit, unit] }, 'Unit id "canvas-1"'],
    [
      "the same slot id twice in a unit",
      withSlots(slot, { ...slot, label: "Again" }),
      'Slot id "1"',
    ],
    [
      "a nozzle range that runs backwards",
      withSlots({ ...slot, nozzleMinC: 231, nozzleMaxC: 230 }),
      "nozzleMinC must not be above nozzleMaxC",
    ],
  ])("refuses %s", (_name, readout, message) => {
    expect(problems(readout)).toEqual([expect.stringContaining(message)]);
  });

  it("lets two units use the same slot ids", () => {
    const other = { ...unit, id: "canvas-2", label: "CANVAS 2" };

    expect(problems({ units: [unit, other] })).toEqual([]);
  });

  it("takes a range of one temperature, or with one end unknown", () => {
    expect(
      problems(
        withSlots(
          { ...slot, id: "a", nozzleMinC: 210, nozzleMaxC: 210 },
          { ...slot, id: "b", nozzleMinC: null, nozzleMaxC: 230 },
          { ...slot, id: "c", nozzleMinC: 260, nozzleMaxC: null },
        ),
      ),
    ).toEqual([]);
  });

  it.each(["#1A1A1A", "1a1a1a", "#1a1a1a80", "#fff", "black", ""])(
    "refuses the colour %j",
    (colorHex) => {
      expect(problems(withSlots({ ...slot, colorHex }))).toEqual([
        "Expected #rrggbb in lowercase",
      ]);
    },
  );

  it.each([
    ["an unknown slot status", { status: "jammed" }],
    ["an empty slot id", { id: "" }],
    ["a missing material", { material: undefined }],
    ["NaN for a temperature", { nozzleMaxC: NaN }],
  ])("refuses %s", (_name, change) => {
    expect(problems(withSlots({ ...slot, ...change }))).not.toEqual([]);
  });

  it("refuses an unknown unit kind", () => {
    expect(problems({ units: [{ ...unit, kind: "canvas" }] })).not.toEqual([]);
  });

  it("doesn't range-check temperatures, since they are driver readings", () => {
    expect(
      problems(withSlots({ ...slot, nozzleMinC: -5, nozzleMaxC: 1000 })),
    ).toEqual([]);
  });
});
