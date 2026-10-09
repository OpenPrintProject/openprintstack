// SPDX-FileCopyrightText: 2026 Open Print Stack contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from "vitest";

import { SIMULATED_SETTINGS_SCHEMA } from "../test/fixtures.ts";
import {
  initialValues,
  serverIssues,
  type SettingsField,
  settingsFields,
  settingsSchema,
  type SettingsValues,
  UnsupportedSettingsError,
} from "./settings-schema.ts";

function schemaOf(
  properties: Record<string, unknown>,
  extra: Record<string, unknown> = {},
): unknown {
  return { type: "object", properties, ...extra };
}

/** The messages for each field, checking `values` against `schema`. */
function problems(
  schema: unknown,
  values: SettingsValues,
): Record<string, string[]> {
  const result = settingsSchema(settingsFields(schema)).safeParse(values);
  const byField: Record<string, string[]> = {};
  for (const issue of result.error?.issues ?? []) {
    const key = String(issue.path[0]);
    (byField[key] ??= []).push(issue.message);
  }
  return byField;
}

describe("settingsFields", () => {
  it("reads the simulated printer's schema: labels, hints, kinds, defaults and limits", () => {
    const fields = settingsFields(SIMULATED_SETTINGS_SCHEMA);

    expect(fields.map((field) => field.key)).toEqual([
      "printDurationS",
      "speedMultiplier",
      "heatUpS",
      "nozzleMaxC",
      "bedMaxC",
      "buildVolumeXMm",
      "buildVolumeYMm",
      "buildVolumeZMm",
      "maxMoveSpeedMmS",
      "cameraEnabled",
      "filamentSlots",
      "accessCode",
    ]);
    expect(fields[0]).toEqual({
      key: "printDurationS",
      label: "Print duration (s)",
      description:
        "How long every print takes, in simulated seconds, not counting heat-up.",
      required: false,
      kind: "number",
      integer: true,
      default: 600,
      minimum: 1,
      maximum: 86400,
      exclusiveMinimum: undefined,
      exclusiveMaximum: undefined,
    });
    expect(fields[1]).toMatchObject({
      kind: "number",
      integer: false,
      minimum: 0.1,
      maximum: 1000,
    });
    expect(fields[9]).toEqual({
      key: "cameraEnabled",
      label: "Camera",
      description: "Whether the printer has a camera that takes snapshots.",
      required: false,
      kind: "boolean",
      default: true,
    });
    expect(fields[10]).toEqual({
      key: "filamentSlots",
      label: "Filament slots",
      description:
        "Whether the printer reports a filament changer with 4 slots, as a CANVAS or an AMS does.",
      required: false,
      kind: "boolean",
      default: false,
    });
    expect(fields[11]).toEqual({
      key: "accessCode",
      label: "Access code",
      description:
        "Optional, and never checked: it shows how a real printer's access code is kept secret.",
      required: false,
      kind: "string",
      writeOnly: true,
      default: undefined,
      minLength: undefined,
      maxLength: 64,
      pattern: undefined,
    });
  });

  it("reads strings, enums and required fields, using the key when there's no title", () => {
    const fields = settingsFields(
      schemaOf(
        {
          host: {
            type: "string",
            minLength: 1,
            maxLength: 253,
            pattern: "^[a-z.]+$",
          },
          mode: { type: "string", enum: ["lan", "cloud"], default: "lan" },
        },
        { required: ["host"], additionalProperties: false },
      ),
    );

    expect(fields).toEqual([
      {
        key: "host",
        label: "host",
        description: undefined,
        required: true,
        kind: "string",
        writeOnly: false,
        default: undefined,
        minLength: 1,
        maxLength: 253,
        pattern: /^[a-z.]+$/u,
      },
      {
        key: "mode",
        label: "mode",
        description: undefined,
        required: false,
        kind: "enum",
        default: "lan",
        options: ["lan", "cloud"],
      },
    ]);
  });

  it("takes an object with no properties", () => {
    expect(settingsFields({ type: "object" })).toEqual([]);
  });

  it.each([
    [
      "a keyword on the schema",
      { type: "object", properties: {}, $defs: {} },
      'The settings schema uses "$defs", which the form doesn\'t support yet.',
    ],
    [
      "a schema that isn't an object type",
      { type: "array" },
      "The settings schema doesn't describe an object.",
    ],
    [
      "a schema that isn't an object",
      [],
      "The settings schema isn't a JSON object.",
    ],
    [
      "a keyword on a field",
      schemaOf({ host: { type: "string", format: "hostname" } }),
      'The setting "host" uses "format", which the form doesn\'t support yet.',
    ],
    [
      "a number keyword on a string",
      schemaOf({ host: { type: "string", minimum: 1 } }),
      'The setting "host" uses "minimum", which the form doesn\'t support yet.',
    ],
    [
      "a nested object",
      schemaOf({ nested: { type: "object", properties: {} } }),
      'The setting "nested" has type "object"; the form takes strings, numbers, integers and booleans.',
    ],
    [
      "a nullable type",
      schemaOf({ port: { type: ["integer", "null"] } }),
      'The setting "port" has type ["integer","null"]; the form takes strings, numbers, integers and booleans.',
    ],
    [
      "a union",
      schemaOf({ port: { anyOf: [{ type: "integer" }, { type: "null" }] } }),
      'The setting "port" has type undefined; the form takes strings, numbers, integers and booleans.',
    ],
    [
      "a key that isn't a plain name",
      schemaOf({ "a.b": { type: "string" } }),
      'The setting "a.b" has a name the form can\'t use as a field name.',
    ],
    [
      "options that aren't strings",
      schemaOf({ mode: { type: "string", enum: [1, 2] } }),
      "The setting \"mode\"'s options aren't a list of strings.",
    ],
    [
      "a default that isn't an option",
      schemaOf({ mode: { type: "string", enum: ["a"], default: "b" } }),
      "The setting \"mode\"'s default isn't one of its options.",
    ],
    [
      "a default of the wrong type",
      schemaOf({ count: { type: "integer", default: 1.5 } }),
      "The setting \"count\"'s default isn't valid.",
    ],
    [
      "a limit that isn't a number",
      schemaOf({ count: { type: "number", maximum: "10" } }),
      "The setting \"count\"'s maximum isn't valid.",
    ],
    [
      "a pattern that isn't a regular expression",
      schemaOf({ host: { type: "string", pattern: "(" } }),
      "The setting \"host\"'s pattern isn't valid.",
    ],
    [
      "a write-only number",
      schemaOf({ pin: { type: "integer", writeOnly: true } }),
      'The setting "pin" uses "writeOnly", which the form doesn\'t support yet.',
    ],
    [
      "a write-only enum",
      schemaOf({ key: { type: "string", enum: ["a"], writeOnly: true } }),
      'The setting "key" uses "writeOnly" with "enum", which the form doesn\'t support yet.',
    ],
    [
      "writeOnly that isn't a boolean",
      schemaOf({ key: { type: "string", writeOnly: "yes" } }),
      "The setting \"key\"'s writeOnly isn't valid.",
    ],
    [
      "required that isn't a list of names",
      schemaOf({}, { required: "host" }),
      "The settings schema's \"required\" isn't a list of names.",
    ],
  ])("refuses %s", (_, schema, message) => {
    expect(() => settingsFields(schema)).toThrow(
      new UnsupportedSettingsError(message),
    );
  });
});

describe("initialValues", () => {
  const fields = settingsFields(
    schemaOf({
      count: { type: "integer", default: 3 },
      speed: { type: "number" },
      on: { type: "boolean", default: true },
      off: { type: "boolean" },
      host: { type: "string", default: "printer.local" },
      note: { type: "string" },
      code: { type: "string", writeOnly: true },
    }),
  );

  it("starts from the defaults, with empty fields and switches off for the rest", () => {
    expect(initialValues(fields)).toEqual({
      count: "3",
      speed: "",
      on: true,
      off: false,
      host: "printer.local",
      note: "",
      code: "",
    });
  });

  it("starts from stored settings when editing", () => {
    expect(
      initialValues(fields, {
        count: 7,
        speed: 0.5,
        on: false,
        off: true,
        host: "bench.local",
        note: "spare",
      }),
    ).toEqual({
      count: "7",
      speed: "0.5",
      on: false,
      off: true,
      host: "bench.local",
      note: "spare",
      code: "",
    });
  });

  it("starts a write-only field empty, whatever it's given", () => {
    expect(initialValues(fields, { code: "1234" }).code).toBe("");
  });
});

describe("settingsSchema", () => {
  it("gives the simulated printer's settings as numbers and booleans", () => {
    const fields = settingsFields(SIMULATED_SETTINGS_SCHEMA);
    const values = { ...initialValues(fields), speedMultiplier: " 60 " };

    expect(settingsSchema(fields).parse(values)).toEqual({
      printDurationS: 600,
      speedMultiplier: 60,
      heatUpS: 20,
      nozzleMaxC: 300,
      bedMaxC: 120,
      buildVolumeXMm: 256,
      buildVolumeYMm: 256,
      buildVolumeZMm: 256,
      maxMoveSpeedMmS: 200,
      cameraEnabled: true,
      filamentSlots: false,
    });
  });

  it("leaves out optional fields left empty", () => {
    const schema = schemaOf({
      speed: { type: "number" },
      note: { type: "string" },
      mode: { type: "string", enum: ["a", "b"] },
    });

    expect(
      settingsSchema(settingsFields(schema)).parse({
        speed: "",
        note: "",
        mode: "",
      }),
    ).toEqual({});
  });

  it("asks for required fields", () => {
    const schema = schemaOf(
      {
        speed: { type: "number" },
        host: { type: "string" },
        mode: { type: "string", enum: ["a", "b"] },
      },
      { required: ["speed", "host", "mode"] },
    );

    expect(problems(schema, { speed: " ", host: "", mode: "" })).toEqual({
      speed: ["Enter a number."],
      host: ["Enter a value."],
      mode: ["Choose one."],
    });
  });

  describe("a required write-only field", () => {
    const fields = settingsFields(
      schemaOf(
        { code: { type: "string", minLength: 4, writeOnly: true } },
        { required: ["code"] },
      ),
    );

    it("must be filled in when nothing is stored", () => {
      const result = settingsSchema(fields).safeParse({ code: "" });

      expect(result.error?.issues.map((issue) => issue.message)).toEqual([
        "Enter a value.",
      ]);
    });

    it("may be left empty when one is stored, which leaves it out", () => {
      expect(settingsSchema(fields, ["code"]).parse({ code: "" })).toEqual({});
    });

    it("is checked and sent when a new one is typed in", () => {
      const schema = settingsSchema(fields, ["code"]);

      expect(schema.parse({ code: "5678" })).toEqual({ code: "5678" });
      expect(schema.safeParse({ code: "567" }).success).toBe(false);
    });
  });

  it.each([
    ["abc", ["Enter a number."]],
    ["1e400", ["Enter a number."]],
    ["0", ["Must be at least 1."]],
    ["86401", ["Must be at most 86,400."]],
    ["1.5", ["Must be a whole number."]],
    ["0.5", ["Must be a whole number.", "Must be at least 1."]],
  ])("checks the print duration %j", (text, messages) => {
    expect(
      problems(SIMULATED_SETTINGS_SCHEMA, {
        ...initialValues(settingsFields(SIMULATED_SETTINGS_SCHEMA)),
        printDurationS: text,
      }),
    ).toEqual({ printDurationS: messages });
  });

  it.each([
    ["0.1", {}],
    ["1000", {}],
    ["0.09", { speedMultiplier: ["Must be at least 0.1."] }],
    ["1000.5", { speedMultiplier: ["Must be at most 1,000."] }],
  ])(
    "takes speed multipliers at both ends of 0.1–1000: %j",
    (text, expected) => {
      expect(
        problems(SIMULATED_SETTINGS_SCHEMA, {
          ...initialValues(settingsFields(SIMULATED_SETTINGS_SCHEMA)),
          speedMultiplier: text,
        }),
      ).toEqual(expected);
    },
  );

  it("checks exclusive limits", () => {
    const schema = schemaOf({
      gap: { type: "number", exclusiveMinimum: 0, exclusiveMaximum: 5 },
    });

    expect(problems(schema, { gap: "0" })).toEqual({
      gap: ["Must be more than 0."],
    });
    expect(problems(schema, { gap: "5" })).toEqual({
      gap: ["Must be less than 5."],
    });
    expect(problems(schema, { gap: "4.99" })).toEqual({});
  });

  it("checks strings' lengths and pattern", () => {
    const schema = schemaOf({
      host: { type: "string", minLength: 3, maxLength: 5, pattern: "^[a-z]+$" },
    });

    expect(problems(schema, { host: "ab" })).toEqual({
      host: ["Must be at least 3 characters."],
    });
    expect(problems(schema, { host: "abcdef" })).toEqual({
      host: ["Must be at most 5 characters."],
    });
    expect(problems(schema, { host: "AB-C" })).toEqual({
      host: ["Isn't in the expected format."],
    });
    expect(problems(schema, { host: "abc" })).toEqual({});
  });

  it("refuses a value that isn't one of the options", () => {
    const schema = schemaOf({ mode: { type: "string", enum: ["a", "b"] } });

    expect(problems(schema, { mode: "c" })).toEqual({
      mode: ["Choose one of the options."],
    });
  });
});

describe("serverIssues", () => {
  const fields: SettingsField[] = settingsFields(SIMULATED_SETTINGS_SCHEMA);

  it("puts each issue on its field, the first one per field", () => {
    const details = [
      {
        code: "too_small",
        path: ["nozzleMaxC"],
        message: "Too small: expected number to be >=100",
      },
      { code: "custom", path: ["nozzleMaxC"], message: "Another." },
      { code: "too_big", path: ["bedMaxC"], message: "Too big." },
    ];

    expect(serverIssues(fields, details)).toEqual({
      byKey: {
        nozzleMaxC: "Too small: expected number to be >=100",
        bedMaxC: "Too big.",
      },
      unmatched: false,
    });
  });

  it("says when an issue isn't about one of the form's fields", () => {
    expect(
      serverIssues(fields, [
        { path: [], message: "Unrecognized key: extra" },
        { path: ["bedMaxC"], message: "Too big." },
      ]),
    ).toEqual({ byKey: { bedMaxC: "Too big." }, unmatched: true });
    expect(serverIssues(fields, [{ path: ["other"], message: "?" }])).toEqual({
      byKey: {},
      unmatched: true,
    });
  });

  it("says details it can't read are unmatched", () => {
    expect(serverIssues(fields, undefined)).toEqual({
      byKey: {},
      unmatched: true,
    });
    expect(serverIssues(fields, [{ nonsense: true }])).toEqual({
      byKey: {},
      unmatched: true,
    });
  });
});
