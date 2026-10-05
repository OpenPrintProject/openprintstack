// SPDX-FileCopyrightText: 2026 Open Print Stack contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { z } from "zod";

/** The normalised status every driver reports, whatever the brand. */
export const PrinterStatus = z
  .enum([
    "connecting",
    "offline",
    "idle",
    "busy",
    "preparing",
    "printing",
    "pausing",
    "paused",
    "cancelling",
    "error",
  ])
  .meta({ id: "PrinterStatus" });

export type PrinterStatus = z.infer<typeof PrinterStatus>;

/**
 * Every status except `connecting` and `offline`. A printer in `error` is
 * still online: it is connected and can, for example, cancel its job.
 */
export const ONLINE_STATUSES: readonly PrinterStatus[] =
  PrinterStatus.options.filter(
    (status) => status !== "connecting" && status !== "offline",
  );

export function isOnline(status: PrinterStatus): boolean {
  return ONLINE_STATUSES.includes(status);
}
