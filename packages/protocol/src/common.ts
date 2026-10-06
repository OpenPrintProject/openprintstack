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

/** Any JSON value. */
export type JsonValue =
  string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

/**
 * Any JSON value, as `z.json()` accepts: strings, finite numbers, booleans,
 * null, arrays and objects. Unlike `z.json()` it has an id and refers to
 * itself, so the OpenAPI spec gets one `JsonValue` component instead of an
 * anonymous copy wherever it's used.
 */
export const JsonValue: z.ZodType<JsonValue, JsonValue> = z
  .lazy(() =>
    z.union([
      z.string(),
      z.number(),
      z.boolean(),
      z.null(),
      z.array(JsonValue),
      z.record(z.string(), JsonValue),
    ]),
  )
  .meta({ id: "JsonValue" });

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
