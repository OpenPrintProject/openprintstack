// SPDX-FileCopyrightText: 2026 Open Print Stack contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import type {
  Filament,
  FilamentSlot,
  FilamentSlotStatus,
} from "@openprintstack/protocol";

// How a printer's filament slots read, in the Filament card and the event
// log. Every field but the status may be unreported (null).

export const SLOT_STATUS_LABEL: Record<FilamentSlotStatus, string> = {
  empty: "Empty",
  loaded: "Loaded",
  active: "Active",
};

/** "PLA · Matte Black", "PLA", or "" when neither is reported. */
export function slotContents(slot: FilamentSlot): string {
  return [slot.material, slot.name]
    .filter((part): part is string => part !== null && part !== "")
    .join(" · ");
}

const oneDecimal = new Intl.NumberFormat("en-GB", {
  maximumFractionDigits: 1,
});

/**
 * The slot's nozzle range: "190–230 °C", "from 260 °C", "up to 230 °C", or
 * null when neither end is reported.
 */
export function nozzleRange({
  nozzleMinC: min,
  nozzleMaxC: max,
}: FilamentSlot): string | null {
  if (min !== null && max !== null) {
    return min === max
      ? `${oneDecimal.format(min)} °C`
      : `${oneDecimal.format(min)}–${oneDecimal.format(max)} °C`;
  }
  if (min !== null) return `from ${oneDecimal.format(min)} °C`;
  if (max !== null) return `up to ${oneDecimal.format(max)} °C`;
  return null;
}

/**
 * The readout in one line, for the event log: per unit, how many slots are
 * loaded and which is active, e.g. "Simulated changer: 3 of 4 loaded, Slot 1
 * active (PLA · White)".
 */
export function filamentSummary(filament: Filament | null): string {
  if (filament === null) return "Not reported";
  if (filament.units.length === 0) return "No units attached";
  return filament.units
    .map((unit) => {
      const loaded = unit.slots.filter((slot) => slot.status !== "empty");
      const active = unit.slots
        .filter((slot) => slot.status === "active")
        .map((slot) => {
          const contents = slotContents(slot);
          return contents === ""
            ? `${slot.label} active`
            : `${slot.label} active (${contents})`;
        });
      const count = `${loaded.length} of ${unit.slots.length} loaded`;
      return `${unit.label}: ${[count, ...active].join(", ")}`;
    })
    .join(" · ");
}
