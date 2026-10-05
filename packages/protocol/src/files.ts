// SPDX-FileCopyrightText: 2026 Open Print Stack contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { z } from "zod";

import { IsoDateTime } from "./common.ts";

/**
 * A file stored on a printer, as its driver lists it. `null` means the printer
 * doesn't report that value. These are driver readings, so values are not
 * range-checked.
 */
export const PrinterFile = z
  .object({
    /** The name `print.start` takes. */
    name: z.string().min(1),
    sizeBytes: z.number().nullable(),
    modifiedAt: IsoDateTime.nullable(),
  })
  .meta({ id: "PrinterFile" });

export type PrinterFile = z.infer<typeof PrinterFile>;
