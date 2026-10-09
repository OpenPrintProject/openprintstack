// SPDX-FileCopyrightText: 2026 Open Print Stack contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { ErrorInfo, PrinterStatus } from "@openprintstack/protocol";

import type { JsonObject } from "./protocol.ts";
import { codesAt, numberAt, objectAt } from "./read.ts";

// How the CC2's `machine_status` becomes our status. Proposed in the Phase 1
// plan and agreed with Rob, to confirm on hardware: the codes come from
// Elegoo's library and the Home Assistant notes.

export type MappedStatus = {
  readonly status: PrinterStatus;
  readonly detail: string | null;
  readonly error: ErrorInfo | null;
};

/** `machine_status.status`: what the printer is doing. */
export const MACHINE = {
  initialising: 0,
  idle: 1,
  printing: 2,
  emergencyStop: 14,
  powerLossRecovery: 15,
} as const;

/** `machine_status.sub_status` values that end a print. */
export const SUB = { completed: 2077, stopped: 2504 } as const;

type Mapping = readonly [PrinterStatus, string | null];

/** Status 2 (printing), by `sub_status`. Any other code means printing. */
const PRINT_SUB_STATUSES: ReadonlyMap<number, Mapping> = new Map([
  ...codes([1045, 1096], ["preparing", "Heating the nozzle"]),
  ...codes([1405, 1906], ["preparing", "Heating the bed"]),
  ...codes([2801, 2802], ["preparing", "Homing"]),
  ...codes([2901, 2902], ["preparing", "Levelling the bed"]),
  ...codes([1081, 1082, 1086], ["preparing", "Downloading the file"]),
  ...codes([2075, 2402], ["printing", null]),
  ...codes([2401], ["printing", "Resuming"]),
  ...codes([2501], ["pausing", null]),
  ...codes([2502, 2505], ["paused", null]),
  ...codes([2503], ["cancelling", null]),
  // The print is over, though the printer may still say "printing" while its
  // screen shows the result. Its job has ended, so it's idle.
  ...codes([SUB.completed, SUB.stopped], ["idle", null]),
]);

/** Every other machine status, with what the printer is busy doing. */
const MACHINE_STATUSES: ReadonlyMap<number, Mapping> = new Map([
  [MACHINE.initialising, ["busy", "Starting up"]],
  [MACHINE.idle, ["idle", null]],
  [3, ["busy", "Loading or unloading filament"]],
  [4, ["busy", "Loading or unloading filament"]],
  [5, ["busy", "Levelling the bed"]],
  [6, ["busy", "Calibrating the heaters"]],
  [7, ["busy", "Testing for resonance"]],
  [8, ["busy", "Running a self-check"]],
  [9, ["busy", "Updating its firmware"]],
  [10, ["busy", "Homing"]],
  [11, ["busy", "Receiving a file"]],
  [12, ["busy", "Making the timelapse video"]],
  [13, ["busy", "Loading or unloading the extruder"]],
  [MACHINE.powerLossRecovery, ["busy", "Recovering from a power cut"]],
]);

export const EMERGENCY_STOP: ErrorInfo = {
  code: "emergency_stop",
  message: "Emergency stop. Check the printer, then restart it.",
};

/** Problem codes from `exception_status` with a known meaning. */
const EXCEPTIONS: ReadonlyMap<number, string> = new Map([
  [109, "Filament ran out"],
  [1026, "No bed mesh: run auto levelling"],
]);

/** One problem code as a sentence, e.g. "Filament ran out (109)." */
export function describeException(code: number): string {
  const known = EXCEPTIONS.get(code);
  return known === undefined
    ? `Printer problem ${code}.`
    : `${known} (${code}).`;
}

/** The active problem codes, in the printer's order, without repeats. */
export function exceptionCodes(status: JsonObject): number[] {
  return [
    ...new Set(codesAt(objectAt(status, "machine_status"), "exception_status")),
  ];
}

/**
 * Our status for the printer's merged status. Problem codes don't change the
 * status (a filament runout stays paused, so it can be resumed); they become
 * its error, which the UI shows in red.
 */
export function mapStatus(status: JsonObject): MappedStatus {
  const machine = objectAt(status, "machine_status");
  const code = numberAt(machine, "status");
  const problems = exceptionCodes(status).map(describeException).join(" ");

  if (code === MACHINE.emergencyStop) {
    return {
      status: "error",
      detail: null,
      error: {
        ...EMERGENCY_STOP,
        message: [EMERGENCY_STOP.message, problems].join(" ").trim(),
      },
    };
  }

  const [ours, detail] =
    code === MACHINE.printing
      ? (PRINT_SUB_STATUSES.get(numberAt(machine, "sub_status") ?? -1) ?? [
          "printing",
          null,
        ])
      : ((code === null ? undefined : MACHINE_STATUSES.get(code)) ?? [
          "busy",
          `Busy (status ${code ?? "unknown"})`,
        ]);

  return {
    status: ours,
    detail,
    error:
      problems === "" ? null : { code: "printer_exception", message: problems },
  };
}

function codes(list: number[], mapping: Mapping): [number, Mapping][] {
  return list.map((code) => [code, mapping]);
}
