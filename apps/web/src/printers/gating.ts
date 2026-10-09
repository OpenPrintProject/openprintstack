// SPDX-FileCopyrightText: 2026 Open Print Stack contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  type Axis,
  COMMAND_POLICY,
  type CommandKind,
  type Fan,
  type Heater,
  isOnline,
  type PrinterState,
  type PrinterStatus,
} from "@openprintstack/protocol";

import { STATUS_PHRASE } from "./status.ts";

// Which controls a printer's page shows, and which it lets you use:
//
//   hidden     the printer's capabilities don't include it (the command
//              kind, a heater or fan that only reports its reading,
//              uploads, the simulator extension), or it hasn't reported
//              them yet
//   disabled   its status doesn't allow it, per protocol's COMMAND_POLICY
//              (the table the server enforces), with the reason; also jogs
//              until the axis is homed and the position known, as the
//              server's safety check requires; and every command while
//              another of the printer's is running
//   enabled    otherwise
//
// The server checks all of this again; these only keep the page from
// offering what it would refuse.

export type Gate =
  | { readonly shown: false }
  | { readonly shown: true; readonly enabled: true }
  | { readonly shown: true; readonly enabled: false; readonly reason: string };

export const HIDDEN: Gate = { shown: false };
const ENABLED: Gate = { shown: true, enabled: true };

function disabled(reason: string): Gate {
  return { shown: true, enabled: false, reason };
}

/** The extension behind the Simulator panel. */
export const SIMULATOR_EXTENSION = "simulator";

/** A command's control: shown if supported, enabled if its status allows. */
export function commandGate(state: PrinterState, kind: CommandKind): Gate {
  const { capabilities } = state;
  if (capabilities === null || !capabilities.commands.includes(kind)) {
    return HIDDEN;
  }
  const refusal = statusRefusal(state.status, kind);
  return refusal === null ? ENABLED : disabled(refusal);
}

/** Why COMMAND_POLICY refuses `kind` while `status`, or null if it allows it. */
export function statusRefusal(
  status: PrinterStatus,
  kind: CommandKind,
): string | null {
  const policy = COMMAND_POLICY[kind];
  if (policy.requiresOnline && !isOnline(status)) {
    return status === "connecting"
      ? "The printer is still connecting."
      : "The printer is offline.";
  }
  if (policy.allowedStatuses.includes(status)) return null;
  const allowed = policy.allowedStatuses.map((each) => STATUS_PHRASE[each]);
  return `Only when the printer is ${orList(allowed)}.`;
}

/** A jog along `axis`: also needs the axis homed and the position known. */
export function jogGate(state: PrinterState, axis: Axis): Gate {
  const gate = commandGate(state, "motion.move");
  if (!gate.shown || !gate.enabled) return gate;
  const { homedAxes, position } = state.telemetry;
  if (!(homedAxes ?? []).includes(axis)) {
    return disabled(`Home ${axis.toUpperCase()} first.`);
  }
  if (position === null) {
    return disabled("Home first: the position isn't known.");
  }
  return gate;
}

/**
 * A heater's target controls; hidden for a heater that only reports its
 * temperature (a sensor).
 */
export function heaterGate(state: PrinterState, heater: Heater): Gate {
  return heater.controllable ? commandGate(state, "temperature.set") : HIDDEN;
}

/** A fan's speed control; hidden for a fan that only reports its speed. */
export function fanGate(state: PrinterState, fan: Fan): Gate {
  return fan.controllable ? commandGate(state, "fan.set") : HIDDEN;
}

/** The Upload button: the printer takes uploads and the command. */
export function uploadGate(state: PrinterState): Gate {
  return state.capabilities?.files.upload === true
    ? commandGate(state, "file.upload")
    : HIDDEN;
}

/** The Simulator panel: the printer has the `simulator` extension. */
export function simulatorGate(state: PrinterState): Gate {
  return state.capabilities?.extensions.includes(SIMULATOR_EXTENSION) === true
    ? commandGate(state, "extension.invoke")
    : HIDDEN;
}

/** While another of the printer's commands runs, nothing else can start. */
export function withLock(gate: Gate, locked: boolean): Gate {
  return gate.shown && gate.enabled && locked
    ? disabled("Waiting for the printer's last command.")
    : gate;
}

const disjunction = new Intl.ListFormat("en-GB", { type: "disjunction" });

function orList(items: readonly string[]): string {
  return disjunction.format(items);
}
