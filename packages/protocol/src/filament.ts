// SPDX-FileCopyrightText: 2026 Open Print Stack contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { z } from "zod";

import { Id } from "./common.ts";

// A read-only readout of a printer's filament: its units (a CANVAS, an AMS, a
// spool holder) and the slots in each. Like telemetry, these are driver
// readings: `null` means the printer doesn't report the value.

/**
 * `changer`: an automatic unit with several slots, such as a CANVAS, AMS or
 * MMU. `external`: a spool holder outside any changer, fed by hand.
 */
export const FilamentUnitKind = z
  .enum(["changer", "external", "other"])
  .meta({ id: "FilamentUnitKind" });

export type FilamentUnitKind = z.infer<typeof FilamentUnitKind>;

/** `active`: the slot is feeding the printer now. */
export const FilamentSlotStatus = z
  .enum(["empty", "loaded", "active"])
  .meta({ id: "FilamentSlotStatus" });

export type FilamentSlotStatus = z.infer<typeof FilamentSlotStatus>;

export const FilamentSlot = z
  .object({
    /** Unique within its unit. */
    id: Id,
    label: z.string(),
    status: FilamentSlotStatus,
    /** The material, such as `PLA` or `PETG`. */
    material: z.string().nullable(),
    /** The filament's own name, such as `Matte Black`. */
    name: z.string().nullable(),
    /** `#` and six lowercase hex digits, such as `#1a2b3c`. */
    colorHex: z
      .string()
      .regex(/^#[0-9a-f]{6}$/, "Expected #rrggbb in lowercase")
      .nullable(),
    /** The filament's nozzle temperature range, in °C. */
    nozzleMinC: z.number().nullable(),
    nozzleMaxC: z.number().nullable(),
  })
  .refine(
    ({ nozzleMinC, nozzleMaxC }) =>
      nozzleMinC === null || nozzleMaxC === null || nozzleMinC <= nozzleMaxC,
    {
      message: "nozzleMinC must not be above nozzleMaxC",
      path: ["nozzleMinC"],
    },
  )
  .meta({ id: "FilamentSlot" });

export type FilamentSlot = z.infer<typeof FilamentSlot>;

export const FilamentUnit = z
  .object({
    /** Unique within the printer. */
    id: Id,
    kind: FilamentUnitKind,
    label: z.string(),
    slots: z.array(FilamentSlot).superRefine((slots, ctx) => {
      for (const id of duplicates(slots.map((slot) => slot.id))) {
        ctx.addIssue({
          code: "custom",
          message: `Slot id "${id}" is used more than once in this unit`,
        });
      }
    }),
  })
  .meta({ id: "FilamentUnit" });

export type FilamentUnit = z.infer<typeof FilamentUnit>;

/**
 * Every filament unit the printer reports. An empty list means it reports
 * filament but has nothing attached; `PrinterState.filament` is null when it
 * doesn't report filament at all.
 */
export const Filament = z
  .object({
    units: z.array(FilamentUnit).superRefine((units, ctx) => {
      for (const id of duplicates(units.map((unit) => unit.id))) {
        ctx.addIssue({
          code: "custom",
          message: `Unit id "${id}" is used more than once`,
        });
      }
    }),
  })
  .meta({ id: "Filament" });

export type Filament = z.infer<typeof Filament>;

/** The values that appear more than once, each named once. */
function duplicates(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const repeated = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) repeated.add(value);
    seen.add(value);
  }
  return [...repeated];
}
