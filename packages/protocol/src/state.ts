// SPDX-FileCopyrightText: 2026 Open Print Stack contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { z } from "zod";

import { Capabilities } from "./capabilities.ts";
import { ErrorInfo, Id, IsoDateTime } from "./common.ts";
import { Filament } from "./filament.ts";
import { PrinterStatus } from "./status.ts";
import { Telemetry } from "./telemetry.ts";

/** A printer's live state, built from its events by `reducePrinterState`. */
export const PrinterState = z
  .object({
    status: PrinterStatus,
    statusDetail: z.string().nullable(),
    error: ErrorInfo.nullable(),
    telemetry: Telemetry,
    /** Null until the driver has reported its capabilities. */
    capabilities: Capabilities.nullable(),
    /**
     * The last filament readout, kept while the printer is offline. Null when
     * the printer doesn't report filament.
     */
    filament: Filament.nullable(),
    /** The `ts` of the last event that changed this state. */
    updatedAt: IsoDateTime,
  })
  .meta({ id: "PrinterState" });

export type PrinterState = z.infer<typeof PrinterState>;

export const PrinterInfo = z
  .object({
    id: Id,
    name: z.string().min(1),
    driverType: z.string().min(1),
  })
  .meta({ id: "PrinterInfo" });

export type PrinterInfo = z.infer<typeof PrinterInfo>;

export const PrinterSnapshot = z
  .object({
    printer: PrinterInfo,
    state: PrinterState,
    /** The `seq` of the last event applied to `state`. */
    seq: z.int().nonnegative(),
  })
  .meta({ id: "PrinterSnapshot" });

export type PrinterSnapshot = z.infer<typeof PrinterSnapshot>;
