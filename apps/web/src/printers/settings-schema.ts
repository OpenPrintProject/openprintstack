// SPDX-FileCopyrightText: 2026 Open Print Stack contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { z } from "zod";

// The add and edit forms are generated from a driver type's settings JSON
// Schema (GET /api/driver-types: draft 2020-12, as Zod writes a driver's
// settings for their input). Settings are flat (driver-sdk's conformance kit
// checks it): every property is a string, an enum, a number, an integer or a
// boolean. This module turns the schema into the form's fields, and checks
// the form's values by the same rules before they're sent:
//
//   string    a text field: minLength, maxLength, pattern
//   enum      a select (a string with `enum`)
//   number    a number field: minimum, maximum, exclusiveMinimum,
//   integer   exclusiveMaximum; an integer must be whole
//   boolean   a switch
//
// Every field may have a title (its label), a description (its hint) and a
// default; one listed in `required` must be filled in, and an optional one
// left empty isn't sent. Any other keyword makes `settingsFields` throw, so a
// driver needing more is noticed rather than its rule silently skipped.

type FieldBase = {
  /** The settings key, e.g. `printDurationS`. */
  readonly key: string;
  readonly label: string;
  readonly description: string | undefined;
  readonly required: boolean;
};

export type StringField = FieldBase & {
  readonly kind: "string";
  readonly default: string | undefined;
  readonly minLength: number | undefined;
  readonly maxLength: number | undefined;
  readonly pattern: RegExp | undefined;
};

export type EnumField = FieldBase & {
  readonly kind: "enum";
  readonly default: string | undefined;
  readonly options: readonly string[];
};

export type NumberField = FieldBase & {
  readonly kind: "number";
  readonly integer: boolean;
  readonly default: number | undefined;
  readonly minimum: number | undefined;
  readonly maximum: number | undefined;
  readonly exclusiveMinimum: number | undefined;
  readonly exclusiveMaximum: number | undefined;
};

export type BooleanField = FieldBase & {
  readonly kind: "boolean";
  readonly default: boolean | undefined;
};

export type SettingsField =
  StringField | EnumField | NumberField | BooleanField;

/** The form's values: text for every field but switches. */
export type SettingsValues = Record<string, string | boolean>;

/** Settings as the API takes them. */
export type Settings = Record<string, string | number | boolean>;

/** The schema uses something the form can't show or check. */
export class UnsupportedSettingsError extends Error {
  override name = "UnsupportedSettingsError";
}

const ROOT_KEYWORDS = new Set([
  "$schema",
  "type",
  "properties",
  "required",
  "additionalProperties",
]);

const FIELD_KEYWORDS = ["type", "title", "description", "default"];

const KEYWORDS_BY_TYPE: Record<string, readonly string[]> = {
  string: ["minLength", "maxLength", "pattern", "enum"],
  number: ["minimum", "maximum", "exclusiveMinimum", "exclusiveMaximum"],
  integer: ["minimum", "maximum", "exclusiveMinimum", "exclusiveMaximum"],
  boolean: [],
};

/**
 * Keys the form can use as field names: TanStack Form reads dots and
 * brackets in a name as a path.
 */
const KEY = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** The form's fields, in the schema's order. */
export function settingsFields(schema: unknown): SettingsField[] {
  const root = record(schema, "The settings schema");
  for (const keyword of Object.keys(root)) {
    if (!ROOT_KEYWORDS.has(keyword)) {
      throw unsupported(`The settings schema uses "${keyword}"`);
    }
  }
  if (root.type !== "object") {
    throw new UnsupportedSettingsError(
      "The settings schema doesn't describe an object.",
    );
  }
  const properties = record(root.properties ?? {}, "Its properties");
  const required = root.required ?? [];
  if (!isStringArray(required)) {
    throw new UnsupportedSettingsError(
      "The settings schema's \"required\" isn't a list of names.",
    );
  }
  return Object.entries(properties).map(([key, property]) =>
    settingsField(key, property, required.includes(key)),
  );
}

function settingsField(
  key: string,
  property: unknown,
  required: boolean,
): SettingsField {
  const where = `The setting "${key}"`;
  if (!KEY.test(key)) {
    throw new UnsupportedSettingsError(
      `${where} has a name the form can't use as a field name.`,
    );
  }
  const schema = record(property, where);
  const type = schema.type;
  const typeKeywords =
    typeof type === "string" ? KEYWORDS_BY_TYPE[type] : undefined;
  if (typeKeywords === undefined) {
    throw new UnsupportedSettingsError(
      `${where} has type ${JSON.stringify(type)}; the form takes strings, numbers, integers and booleans.`,
    );
  }
  const keywords = new Set([...FIELD_KEYWORDS, ...typeKeywords]);
  for (const keyword of Object.keys(schema)) {
    if (!keywords.has(keyword)) throw unsupported(`${where} uses "${keyword}"`);
  }
  const base: FieldBase = {
    key,
    label: optional(schema.title, isString, `${where}'s title`) ?? key,
    description: optional(
      schema.description,
      isString,
      `${where}'s description`,
    ),
    required,
  };

  switch (type) {
    case "boolean":
      return {
        ...base,
        kind: "boolean",
        default: optional(schema.default, isBoolean, `${where}'s default`),
      };
    case "number":
    case "integer": {
      const integer = type === "integer";
      const fieldDefault = optional(
        schema.default,
        integer ? isWholeNumber : isFiniteNumber,
        `${where}'s default`,
      );
      return {
        ...base,
        kind: "number",
        integer,
        default: fieldDefault,
        minimum: optional(schema.minimum, isFiniteNumber, `${where}'s minimum`),
        maximum: optional(schema.maximum, isFiniteNumber, `${where}'s maximum`),
        exclusiveMinimum: optional(
          schema.exclusiveMinimum,
          isFiniteNumber,
          `${where}'s exclusiveMinimum`,
        ),
        exclusiveMaximum: optional(
          schema.exclusiveMaximum,
          isFiniteNumber,
          `${where}'s exclusiveMaximum`,
        ),
      };
    }
    default: {
      const fieldDefault = optional(
        schema.default,
        isString,
        `${where}'s default`,
      );
      if (schema.enum !== undefined) {
        if (!isStringArray(schema.enum) || schema.enum.length === 0) {
          throw new UnsupportedSettingsError(
            `${where}'s options aren't a list of strings.`,
          );
        }
        for (const keyword of ["minLength", "maxLength", "pattern"]) {
          if (keyword in schema)
            throw unsupported(`${where} uses "${keyword}" with "enum"`);
        }
        if (fieldDefault !== undefined && !schema.enum.includes(fieldDefault)) {
          throw new UnsupportedSettingsError(
            `${where}'s default isn't one of its options.`,
          );
        }
        return {
          ...base,
          kind: "enum",
          default: fieldDefault,
          options: schema.enum,
        };
      }
      return {
        ...base,
        kind: "string",
        default: fieldDefault,
        minLength: optional(schema.minLength, isCount, `${where}'s minLength`),
        maxLength: optional(schema.maxLength, isCount, `${where}'s maxLength`),
        pattern: pattern(schema.pattern, where),
      };
    }
  }
}

/**
 * The form's starting values: the stored settings (when editing), else each
 * field's default, else empty (off for a switch).
 */
export function initialValues(
  fields: readonly SettingsField[],
  settings: Readonly<Record<string, unknown>> = {},
): SettingsValues {
  return Object.fromEntries(
    fields.map((field): [string, string | boolean] => {
      const value = settings[field.key] ?? field.default;
      switch (field.kind) {
        case "boolean":
          return [field.key, value === true];
        case "number":
          return [field.key, typeof value === "number" ? String(value) : ""];
        default:
          return [field.key, typeof value === "string" ? value : ""];
      }
    }),
  );
}

/**
 * Checks the form's values by the fields' rules, giving the settings to send:
 * numbers as numbers, and empty optional fields left out.
 */
export function settingsSchema(
  fields: readonly SettingsField[],
): z.ZodType<Settings, SettingsValues> {
  const shape = Object.fromEntries(
    fields.map((field) => [field.key, fieldSchema(field)]),
  );
  return z
    .object(shape)
    .transform(
      (values) =>
        Object.fromEntries(
          Object.entries(values).filter(([, value]) => value !== undefined),
        ) as Settings,
    ) as unknown as z.ZodType<Settings, SettingsValues>;
}

function fieldSchema(field: SettingsField): z.ZodType {
  switch (field.kind) {
    case "boolean":
      return z.boolean();
    case "enum":
      return z.string().transform((value, ctx) => {
        if (value === "") {
          if (field.required) issue(ctx, "Choose one.");
          return undefined;
        }
        if (!field.options.includes(value)) {
          issue(ctx, "Choose one of the options.");
        }
        return value;
      });
    case "string":
      return z.string().transform((value, ctx) => {
        if (value === "") {
          if (field.required) issue(ctx, "Enter a value.");
          return undefined;
        }
        // Zod, which the server checks with, counts UTF-16 units, as
        // `length` does.
        if (field.minLength !== undefined && value.length < field.minLength) {
          issue(ctx, `Must be at least ${count(field.minLength)} characters.`);
        }
        if (field.maxLength !== undefined && value.length > field.maxLength) {
          issue(ctx, `Must be at most ${count(field.maxLength)} characters.`);
        }
        if (field.pattern !== undefined && !field.pattern.test(value)) {
          issue(ctx, "Isn't in the expected format.");
        }
        return value;
      });
    case "number":
      return z.string().transform((text, ctx) => {
        const trimmed = text.trim();
        if (trimmed === "") {
          if (field.required) issue(ctx, "Enter a number.");
          return undefined;
        }
        const value = Number(trimmed);
        if (!Number.isFinite(value)) {
          issue(ctx, "Enter a number.");
          return z.NEVER;
        }
        for (const problem of numberProblems(field, value)) issue(ctx, problem);
        return value;
      });
  }
}

function numberProblems(field: NumberField, value: number): string[] {
  const problems: string[] = [];
  if (field.integer && !Number.isInteger(value)) {
    problems.push("Must be a whole number.");
  }
  if (field.minimum !== undefined && !(value >= field.minimum)) {
    problems.push(`Must be at least ${count(field.minimum)}.`);
  }
  if (
    field.exclusiveMinimum !== undefined &&
    !(value > field.exclusiveMinimum)
  ) {
    problems.push(`Must be more than ${count(field.exclusiveMinimum)}.`);
  }
  if (field.maximum !== undefined && !(value <= field.maximum)) {
    problems.push(`Must be at most ${count(field.maximum)}.`);
  }
  if (
    field.exclusiveMaximum !== undefined &&
    !(value < field.exclusiveMaximum)
  ) {
    problems.push(`Must be less than ${count(field.exclusiveMaximum)}.`);
  }
  return problems;
}

/**
 * The server's `invalid_settings` details (Zod's issues, each with a `path`)
 * as one message per settings key. `unmatched` says some issue wasn't about a
 * single field the form has.
 */
export function serverIssues(
  fields: readonly SettingsField[],
  details: unknown,
): { byKey: Record<string, string>; unmatched: boolean } {
  const keys = new Set(fields.map((field) => field.key));
  const byKey: Record<string, string> = {};
  let unmatched = false;
  const issues = Array.isArray(details) ? (details as unknown[]) : [];
  for (const each of issues) {
    const parsed = ServerIssue.safeParse(each);
    const key = parsed.data?.path[0];
    if (parsed.success && typeof key === "string" && keys.has(key)) {
      byKey[key] ??= parsed.data.message;
    } else {
      unmatched = true;
    }
  }
  return { byKey, unmatched: unmatched || issues.length === 0 };
}

const ServerIssue = z.object({
  path: z.array(z.union([z.string(), z.number()])),
  message: z.string(),
});

const numbers = new Intl.NumberFormat("en-GB", { maximumFractionDigits: 20 });

function count(value: number): string {
  return numbers.format(value);
}

function issue(ctx: z.RefinementCtx, message: string): void {
  ctx.addIssue({ code: "custom", message });
}

function unsupported(what: string): UnsupportedSettingsError {
  return new UnsupportedSettingsError(
    `${what}, which the form doesn't support yet.`,
  );
}

function record(value: unknown, what: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new UnsupportedSettingsError(`${what} isn't a JSON object.`);
  }
  return value as Record<string, unknown>;
}

function optional<T>(
  value: unknown,
  check: (value: unknown) => value is T,
  what: string,
): T | undefined;
function optional(
  value: unknown,
  check: (value: unknown) => boolean,
  what: string,
): unknown;
function optional(
  value: unknown,
  check: (value: unknown) => boolean,
  what: string,
): unknown {
  if (value === undefined) return undefined;
  if (!check(value)) {
    throw new UnsupportedSettingsError(`${what} isn't valid.`);
  }
  return value;
}

function pattern(value: unknown, where: string): RegExp | undefined {
  const source = optional(value, isString, `${where}'s pattern`);
  if (source === undefined) return undefined;
  try {
    // JSON Schema patterns are ECMAScript regular expressions, unanchored.
    return new RegExp(source, "u");
  } catch {
    throw new UnsupportedSettingsError(`${where}'s pattern isn't valid.`);
  }
}

function isString(value: unknown): value is string {
  return typeof value === "string";
}

function isBoolean(value: unknown): value is boolean {
  return typeof value === "boolean";
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isWholeNumber(value: unknown): value is number {
  return Number.isSafeInteger(value);
}

function isCount(value: unknown): value is number {
  return isWholeNumber(value) && value >= 0;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(isString);
}
