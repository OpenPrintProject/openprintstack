// SPDX-FileCopyrightText: 2026 Open Print Stack contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  emptyTelemetry,
  isOnline,
  type Telemetry,
} from "@openprintstack/protocol";

import type { DriverMessage } from "./messages.ts";

/**
 * The host's merged telemetry after one driver message. `printer.telemetry`
 * events carry the full result, never the patch. Pure: it never mutates its
 * inputs, and returns `telemetry` itself for messages that don't touch it.
 *
 * - `telemetry` replaces each top-level field the patch sets.
 * - `job` replaces `telemetry.job`.
 * - A `status` of `offline` or `connecting` resets it to "nothing reported",
 *   as `reducePrinterState` does. Without the reset, the next patch would bring
 *   back stale readings, including homed axes that would allow a jog.
 */
export function reduceTelemetry(
  telemetry: Telemetry,
  message: DriverMessage,
): Telemetry {
  switch (message.type) {
    case "telemetry": {
      const changed = Object.entries(message.telemetry).filter(
        ([, value]) => value !== undefined,
      );
      return changed.length === 0
        ? telemetry
        : { ...telemetry, ...Object.fromEntries(changed) };
    }
    case "job":
      return { ...telemetry, job: message.job };
    case "status":
      return isOnline(message.status) ? telemetry : emptyTelemetry();
    default:
      return telemetry;
  }
}
