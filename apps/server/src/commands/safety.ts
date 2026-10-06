// SPDX-FileCopyrightText: 2026 Open Print Stack contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import type {
  Axis,
  Capabilities,
  PrinterCommand,
  PrinterCommandOf,
  PrinterState,
} from "@openprintstack/protocol";

import type { CommandError } from "./errors.ts";

// The one central check of a command's values against the printer's limits,
// run just before the driver is called. It doesn't rely on the command having
// been parsed: every rule says what is allowed ("0 ≤ target ≤ maxC"), so NaN
// fails too. A limit the printer doesn't report refuses what it would limit.

const AXES: readonly Axis[] = ["x", "y", "z"];

/** Returns why the command is outside the printer's limits, or null. */
export function checkSafety(
  command: PrinterCommand,
  state: PrinterState,
): CommandError | null {
  switch (command.kind) {
    case "temperature.set":
      return checkTemperature(command, state.capabilities);
    case "fan.set":
      return checkFan(command);
    case "motion.move":
      return checkMove(command, state);
    case "file.upload":
      return checkUpload(command, state.capabilities);
    default:
      return null;
  }
}

function checkTemperature(
  { heaterId, targetC }: PrinterCommandOf<"temperature.set">,
  capabilities: Capabilities | null,
): CommandError | null {
  const heater = capabilities?.heaters.find(({ id }) => id === heaterId);
  if (heater === undefined) {
    return unsafe(
      `The printer has no heater "${heaterId}", so its limit is unknown.`,
    );
  }
  if (!(targetC >= 0)) {
    return unsafe("The target must be 0 °C or more.");
  }
  if (!(targetC <= heater.maxC)) {
    return unsafe(
      `${targetC} °C is above the ${heater.label}'s ${heater.maxC} °C maximum.`,
    );
  }
  return null;
}

function checkFan({
  percent,
}: PrinterCommandOf<"fan.set">): CommandError | null {
  if (!(percent >= 0 && percent <= 100)) {
    return unsafe("A fan's speed must be from 0 to 100 %.");
  }
  return null;
}

/**
 * A jog: a relative move, allowed only once every axis it moves is homed and
 * the position is known, and only if it stays inside the build volume.
 */
function checkMove(
  command: PrinterCommandOf<"motion.move">,
  { telemetry, capabilities }: PrinterState,
): CommandError | null {
  const deltas: Record<Axis, number | undefined> = {
    x: command.x,
    y: command.y,
    z: command.z,
  };
  const axes = AXES.filter((axis) => deltas[axis] !== undefined);
  if (axes.length === 0) {
    return unsafe("A jog needs at least one of x, y or z.");
  }
  if (!axes.every((axis) => Number.isFinite(deltas[axis]))) {
    return unsafe("A jog's distances must be numbers.");
  }

  const unhomed = axes.filter(
    (axis) => !(telemetry.homedAxes ?? []).includes(axis),
  );
  if (unhomed.length > 0) {
    return unsafe(`Home ${list(unhomed, "and")} before jogging.`);
  }
  const { position } = telemetry;
  if (position === null) {
    return unsafe("Home the printer before jogging: its position isn't known.");
  }

  const volume = capabilities?.axes ?? null;
  if (volume === null) {
    return unsafe(
      "The printer doesn't report its build volume, so jogs are refused.",
    );
  }
  for (const axis of axes) {
    // Rounded to a micrometre, so repeated jogs can reach an edge exactly.
    const to = roundMm(position[axis] + (deltas[axis] ?? 0));
    const { minMm, maxMm } = volume[axis];
    if (!(to >= minMm && to <= maxMm)) {
      return unsafe(
        `That jog would take ${axis} to ${to} mm, outside ${minMm}–${maxMm} mm.`,
      );
    }
  }

  const { speedMmS } = command;
  if (speedMmS !== undefined) {
    const maxMmS = capabilities?.maxMoveSpeedMmS ?? null;
    if (!(speedMmS > 0)) {
      return unsafe("A jog's speed must be more than 0 mm/s.");
    }
    if (maxMmS === null) {
      return unsafe(
        "The printer doesn't report a maximum speed, so a jog can't set one.",
      );
    }
    if (!(speedMmS <= maxMmS)) {
      return unsafe(
        `${speedMmS} mm/s is faster than the printer's ${maxMmS} mm/s maximum.`,
      );
    }
  }
  return null;
}

function checkUpload(
  { sizeBytes }: PrinterCommandOf<"file.upload">,
  capabilities: Capabilities | null,
): CommandError | null {
  if (!(Number.isSafeInteger(sizeBytes) && sizeBytes >= 0)) {
    return unsafe("A file's size must be a whole number of bytes.");
  }
  // null means the printer doesn't report a limit.
  const maxBytes = capabilities?.files.maxUploadBytes ?? null;
  if (maxBytes !== null && !(sizeBytes <= maxBytes)) {
    return {
      code: "file_too_large",
      message: `The file is ${sizeBytes} bytes; the printer takes at most ${maxBytes}.`,
    };
  }
  return null;
}

function unsafe(message: string): CommandError {
  return { code: "unsafe", message };
}

function roundMm(mm: number): number {
  return Math.round(mm * 1000) / 1000;
}

/** "x", "x and y", "x, y and z". */
export function list(items: readonly string[], type: "and" | "or"): string {
  return new Intl.ListFormat("en-GB", {
    type: type === "and" ? "conjunction" : "disjunction",
  }).format(items);
}
