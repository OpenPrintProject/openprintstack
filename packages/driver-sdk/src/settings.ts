// SPDX-FileCopyrightText: 2026 Open Print Stack contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { z } from "zod";

import type { DriverModule, SettingsSchema } from "./contract.ts";

/**
 * The JSON Schema of a driver's settings, which the UI renders as a form and
 * `GET /api/driver-types` returns. It describes the input, so fields with a
 * `.default()` are optional and carry their `default`.
 */
export function settingsJsonSchema(
  module: DriverModule,
): z.core.JSONSchema.BaseSchema {
  return z.toJSONSchema(module.settingsSchema, { io: "input" });
}

/**
 * The value of every settings field that has a `.default()`. Fields without
 * one (such as a printer's address) are left out.
 *
 * Zod doesn't check a default against its own field, so the conformance kit
 * parses these explicitly.
 */
export function defaultSettings<S extends SettingsSchema>(
  module: DriverModule<S>,
): Partial<z.output<S>> {
  const properties = settingsJsonSchema(module).properties ?? {};
  return Object.fromEntries(
    Object.entries(properties).flatMap(([key, property]) =>
      typeof property === "object" && "default" in property
        ? [[key, property.default]]
        : [],
    ),
  ) as Partial<z.output<S>>;
}
