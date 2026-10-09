// SPDX-FileCopyrightText: 2026 Open Print Stack contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { Filament, FilamentSlot } from "@openprintstack/protocol";

import type { SimulatedSettings } from "./settings.ts";

// The simulated filament changer, when the "Filament slots" setting is on: one
// unit of 4 slots whose contents never change. The first slot feeds the
// printer while there's a job.

const CHANGER = {
  id: "changer",
  kind: "changer",
  label: "Simulated changer",
} as const;

type Contents = Omit<FilamentSlot, "id" | "label" | "status">;

const EMPTY: Contents = {
  material: null,
  name: null,
  colorHex: null,
  nozzleMinC: null,
  nozzleMaxC: null,
};

/** What each slot holds, in order. The last one is empty. */
const SLOT_CONTENTS: readonly Contents[] = [
  {
    material: "PLA",
    name: "White",
    colorHex: "#ffffff",
    nozzleMinC: 190,
    nozzleMaxC: 230,
  },
  {
    material: "PLA",
    name: "Black",
    colorHex: "#1a1a1a",
    nozzleMinC: 190,
    nozzleMaxC: 230,
  },
  {
    material: "PETG",
    name: "Red",
    colorHex: "#c62828",
    nozzleMinC: 220,
    nozzleMaxC: 260,
  },
  EMPTY,
];

/**
 * The readout, or null if the printer has no changer. Slot 1 is active while
 * there's a job (from start until it ends, through pauses and errors).
 */
export function simulatedFilament(
  settings: SimulatedSettings,
  hasJob: boolean,
): Filament | null {
  if (!settings.filamentSlots) {
    return null;
  }
  const slots = SLOT_CONTENTS.map((contents, index): FilamentSlot => {
    const loaded = contents.material !== null;
    return {
      id: String(index + 1),
      label: `Slot ${index + 1}`,
      status: !loaded ? "empty" : index === 0 && hasJob ? "active" : "loaded",
      ...contents,
    };
  });
  return { units: [{ ...CHANGER, slots }] };
}
