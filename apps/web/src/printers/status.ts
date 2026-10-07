// SPDX-FileCopyrightText: 2026 Open Print Stack contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { PrinterStatus } from "@openprintstack/protocol";

/** How each status reads in the UI. */
export const STATUS_LABEL: Record<PrinterStatus, string> = {
  connecting: "Connecting",
  offline: "Offline",
  idle: "Idle",
  busy: "Busy",
  preparing: "Preparing",
  printing: "Printing",
  pausing: "Pausing",
  paused: "Paused",
  cancelling: "Cancelling",
  error: "Error",
};

/** Each status after "the printer is…". */
export const STATUS_PHRASE: Record<PrinterStatus, string> = {
  connecting: "connecting",
  offline: "offline",
  idle: "idle",
  busy: "busy",
  preparing: "preparing",
  printing: "printing",
  pausing: "pausing",
  paused: "paused",
  cancelling: "cancelling",
  error: "in error",
};
