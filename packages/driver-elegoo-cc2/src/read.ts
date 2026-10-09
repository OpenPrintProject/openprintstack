// SPDX-FileCopyrightText: 2026 Open Print Stack contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { JsonObject } from "./protocol.ts";

// Careful readers for the printer's status, which may leave anything out.

/** The object at `key`, or an empty one if it's missing or not an object. */
export function objectAt(status: JsonObject, key: string): JsonObject {
  const value = status[key];
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as JsonObject)
    : {};
}

/** The finite number at `key`, or null. */
export function numberAt(object: JsonObject, key: string): number | null {
  const value = object[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** The string at `key`, or null if it's missing or empty. */
export function stringAt(object: JsonObject, key: string): string | null {
  const value = object[key];
  return typeof value === "string" && value !== "" ? value : null;
}

/** The whole numbers in the array at `key`, or an empty list. */
export function codesAt(object: JsonObject, key: string): number[] {
  const value = object[key];
  return Array.isArray(value)
    ? value.filter((item): item is number => Number.isSafeInteger(item))
    : [];
}
