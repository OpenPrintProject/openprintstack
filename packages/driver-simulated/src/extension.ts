// SPDX-FileCopyrightText: 2026 Open Print Stack contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { DriverError } from "@openprintstack/driver-sdk";
import { z } from "zod";

import { SPEED_MULTIPLIER } from "./settings.ts";

// The `simulator` extension's actions and their params, which arrive as the
// JSON `params` of an `extension.invoke` command.

const NoParams = z.union([z.null(), z.strictObject({})]);

export const SimulatorParams = {
  /** Puts the printer in error, with an optional message. */
  "fault.error": z.union([
    z.null(),
    z.strictObject({ message: z.string().min(1).max(500).optional() }),
  ]),
  /** Pauses a running print and raises a `filament_runout` alert. */
  "fault.filament_runout": NoParams,
  /** Makes the printer unreachable for `durationS` real seconds. */
  "fault.disconnect": z.strictObject({
    durationS: z.number().min(1).max(3600),
  }),
  /** Ends an error (failing a frozen job) and any simulated disconnect. */
  clear: NoParams,
  /** Changes the simulation speed until the driver restarts. */
  set_speed: z.strictObject({
    multiplier: z.number().min(SPEED_MULTIPLIER.min).max(SPEED_MULTIPLIER.max),
  }),
} as const;

export type SimulatorAction = keyof typeof SimulatorParams;

export function isSimulatorAction(action: string): action is SimulatorAction {
  return Object.hasOwn(SimulatorParams, action);
}

/** Parses an action's params, refusing bad ones as `printer_rejected`. */
export function parseParams<A extends SimulatorAction>(
  action: A,
  params: unknown,
): z.output<(typeof SimulatorParams)[A]> {
  const result = SimulatorParams[action].safeParse(params);
  if (!result.success) {
    const problems = result.error.issues.map((issue) =>
      issue.path.length === 0
        ? issue.message
        : `${issue.path.join(".")}: ${issue.message}`,
    );
    throw new DriverError(
      "printer_rejected",
      `Invalid params for ${action}: ${problems.join("; ")}.`,
    );
  }
  return result.data as z.output<(typeof SimulatorParams)[A]>;
}
