// SPDX-FileCopyrightText: 2026 Open Print Stack contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  type DriverModule,
  writeOnlySettings,
} from "@openprintstack/driver-sdk";

import type { PrinterSettings } from "../db/schema.ts";

// A printer's secrets are the values of its write-only settings (fields its
// driver marks `.meta({ writeOnly: true })`), such as an access code. The
// server stores them with the other settings and gives them to the driver,
// but never shows them again:
//
//   config   a printer's config leaves them out; `secretsSet` names the
//            ones that have a value
//   input    an empty value counts as not given, so an edit keeps the
//            stored one, and a new value replaces it
//   driver   the driver host replaces their values with "[Redacted]" in
//            everything the driver sends before it's logged, published or
//            answered

/** What a secret is replaced with, as pino's own redaction writes it. */
export const REDACTED = "[Redacted]";

type Settings = Readonly<Record<string, unknown>>;

/** The write-only fields that have a stored value, in the schema's order. */
export function secretsSet(
  settings: Settings,
  writeOnly: readonly string[],
): string[] {
  return writeOnly.filter((key) => isSecret(settings[key]));
}

/** The settings without their write-only fields. */
export function withoutSecrets(
  settings: PrinterSettings,
  writeOnly: readonly string[],
): PrinterSettings {
  return Object.fromEntries(
    Object.entries(settings).filter(([key]) => !writeOnly.includes(key)),
  );
}

/**
 * Settings as entered, with each empty write-only value left out, so it counts
 * as not given. Input that isn't an object is returned as it is, for the
 * settings schema to refuse.
 */
export function withoutBlankSecrets<T>(
  input: T,
  writeOnly: readonly string[],
): T {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return input;
  }
  return Object.fromEntries(
    Object.entries(input).filter(
      ([key, value]) => !(value === "" && writeOnly.includes(key)),
    ),
  ) as T;
}

/** The printer's secret values: its write-only settings that are set. */
export function secretValues(
  module: DriverModule,
  settings: Settings,
): string[] {
  return writeOnlySettings(module)
    .map((key) => settings[key])
    .filter(isSecret);
}

/**
 * `value` with each secret replaced by "[Redacted]" wherever it appears in a
 * string, keys included, inside arrays and objects too. It's meant for
 * JSON-like data (driver messages, errors as pino serialises them): objects
 * come back as plain copies of their own enumerable fields, while numbers and
 * byte arrays are kept as they are. With no secrets, `value` itself is
 * returned.
 */
export function redactSecrets<T>(value: T, secrets: readonly string[]): T {
  if (secrets.length === 0) return value;
  // One pass, longest first, so a secret containing another is replaced
  // whole and "[Redacted]" itself is never searched.
  const pattern = new RegExp(
    [...new Set(secrets)]
      .sort((a, b) => b.length - a.length)
      .map(escapeRegExp)
      .join("|"),
    "g",
  );
  return redact(value, pattern) as T;
}

function redact(value: unknown, pattern: RegExp): unknown {
  if (typeof value === "string") return value.replace(pattern, REDACTED);
  if (Array.isArray(value)) return value.map((item) => redact(item, pattern));
  if (
    typeof value === "object" &&
    value !== null &&
    !ArrayBuffer.isView(value)
  ) {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key.replace(pattern, REDACTED),
        redact(item, pattern),
      ]),
    );
  }
  return value;
}

function isSecret(value: unknown): value is string {
  return typeof value === "string" && value !== "";
}

function escapeRegExp(text: string): string {
  return text.replace(/[\\^$.*+?()[\]{}|]/g, "\\$&");
}
