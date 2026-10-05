// SPDX-FileCopyrightText: 2026 Open Print Stack contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { z } from "zod";

/** An opaque, non-empty identifier (printer, user, heater, fan, etc.). */
export const Id = z.string().min(1);

/**
 * A UTC timestamp as an ISO 8601 string, as `Date.prototype.toISOString()`
 * produces. Timestamps are never `Date` objects, so they survive JSON and
 * `structuredClone` unchanged.
 */
export const IsoDateTime = z.iso.datetime();

export const Axis = z.enum(["x", "y", "z"]).meta({ id: "Axis" });

export type Axis = z.infer<typeof Axis>;

/** A machine-readable code with a human-readable message. */
export const ErrorInfo = z
  .object({
    code: z.string().min(1),
    message: z.string(),
  })
  .meta({ id: "ErrorInfo" });

export type ErrorInfo = z.infer<typeof ErrorInfo>;
