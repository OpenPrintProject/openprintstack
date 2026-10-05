// SPDX-FileCopyrightText: 2026 Open Print Stack contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { CommandKind } from "./commands.ts";
import { ONLINE_STATUSES, PrinterStatus } from "./status.ts";

export interface CommandPolicy {
  /** The statuses a printer must be in to accept the command. */
  readonly allowedStatuses: readonly PrinterStatus[];
  /**
   * Whether the command fails straight away with `printer_offline` while the
   * printer is offline or connecting. Commands are never queued.
   */
  readonly requiresOnline: boolean;
}

const HEAT_AND_FAN_STATUSES: readonly PrinterStatus[] = [
  "idle",
  "busy",
  "preparing",
  "printing",
  "pausing",
  "paused",
];

/**
 * When each command is allowed. The server enforces this table and the web app
 * uses it to enable or disable controls. Whether a printer supports a command
 * at all is `capabilities.commands`.
 */
export const COMMAND_POLICY: Readonly<Record<CommandKind, CommandPolicy>> = {
  "print.start": { allowedStatuses: ["idle"], requiresOnline: true },
  "print.pause": {
    allowedStatuses: ["preparing", "printing"],
    requiresOnline: true,
  },
  "print.resume": { allowedStatuses: ["paused"], requiresOnline: true },
  "print.cancel": {
    allowedStatuses: ["preparing", "printing", "pausing", "paused", "error"],
    requiresOnline: true,
  },
  "motion.home": { allowedStatuses: ["idle"], requiresOnline: true },
  "motion.move": { allowedStatuses: ["idle"], requiresOnline: true },
  "temperature.set": {
    allowedStatuses: HEAT_AND_FAN_STATUSES,
    requiresOnline: true,
  },
  "fan.set": { allowedStatuses: HEAT_AND_FAN_STATUSES, requiresOnline: true },
  "file.upload": { allowedStatuses: ONLINE_STATUSES, requiresOnline: true },
  // The driver decides, so that e.g. the simulator can clear a fault while
  // the printer is offline.
  "extension.invoke": {
    allowedStatuses: PrinterStatus.options,
    requiresOnline: false,
  },
};
