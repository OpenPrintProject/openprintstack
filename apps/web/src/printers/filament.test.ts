// SPDX-FileCopyrightText: 2026 Open Print Stack contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { Filament, FilamentSlot } from "@openprintstack/protocol";
import { filamentFixture } from "@openprintstack/protocol/fixtures";
import { describe, expect, it } from "vitest";

import { filamentSummary, nozzleRange, slotContents } from "./filament.ts";

const SLOT: FilamentSlot = filamentFixture.units[0]!.slots[0]!;

describe("slotContents", () => {
  it.each([
    ["PLA", "Matte Black", "PLA · Matte Black"],
    ["PLA", null, "PLA"],
    [null, "Matte Black", "Matte Black"],
    ["PLA", "", "PLA"],
    [null, null, ""],
  ])("reads %j and %j as %j", (material, name, expected) => {
    expect(slotContents({ ...SLOT, material, name })).toBe(expected);
  });
});

describe("nozzleRange", () => {
  it.each([
    [190, 230, "190–230 °C"],
    [210, 210, "210 °C"],
    [192.5, 230, "192.5–230 °C"],
    [260, null, "from 260 °C"],
    [null, 230, "up to 230 °C"],
    [null, null, null],
  ])("reads %j to %j as %j", (nozzleMinC, nozzleMaxC, expected) => {
    expect(nozzleRange({ ...SLOT, nozzleMinC, nozzleMaxC })).toBe(expected);
  });
});

describe("filamentSummary", () => {
  it("counts each unit's loaded slots and names the active one", () => {
    expect(filamentSummary(filamentFixture)).toBe(
      "CANVAS 1: 2 of 3 loaded, Tray 1 active (PLA · Matte Black)",
    );
  });

  it("joins units, and names an active slot that reports nothing else", () => {
    const [unit] = filamentFixture.units;
    const filament: Filament = {
      units: [
        {
          ...unit!,
          slots: unit!.slots.map((slot) => ({ ...slot, status: "loaded" })),
        },
        {
          id: "spool",
          kind: "external",
          label: "Spool holder",
          slots: [
            {
              ...SLOT,
              id: "1",
              label: "Spool",
              material: null,
              name: null,
            },
          ],
        },
      ],
    };

    expect(filamentSummary(filament)).toBe(
      "CANVAS 1: 3 of 3 loaded · Spool holder: 1 of 1 loaded, Spool active",
    );
  });

  it("says when nothing is attached, or filament isn't reported", () => {
    expect(filamentSummary({ units: [] })).toBe("No units attached");
    expect(filamentSummary(null)).toBe("Not reported");
  });
});
