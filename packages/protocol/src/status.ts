// SPDX-FileCopyrightText: 2026 Open Print Stack contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { z } from "zod";

/** The normalised status every driver reports, whatever the brand. */
export const PrinterStatus = z.enum([
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
]);

export type PrinterStatus = z.infer<typeof PrinterStatus>;
