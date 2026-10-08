// SPDX-FileCopyrightText: 2026 Open Print Stack contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { PrinterName } from "@openprintstack/protocol";
import { useMemo, useState } from "react";
import { z } from "zod";

import { apiError, errorCode, errorMessage } from "../api/errors.ts";
import {
  FormFailure,
  useAppForm,
  validationLogic,
} from "../components/form.tsx";
import { Alert, AlertDescription } from "../components/ui/alert.tsx";
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  FieldSeparator,
} from "../components/ui/field.tsx";
import {
  NativeSelect,
  NativeSelectOption,
} from "../components/ui/native-select.tsx";
import type { DriverType } from "./api.ts";
import {
  initialValues,
  isStoredSecret,
  serverIssues,
  type Settings,
  type SettingsField,
  settingsFields,
  settingsSchema,
  UnsupportedSettingsError,
} from "./settings-schema.ts";

// The add and edit forms: a name, the printer type, and the settings form
// generated from the type's JSON Schema (settings-schema.ts). Everything is
// checked before sending, by protocol's name rules and the schema's; the
// server's answer goes on its field (a taken name, an invalid setting) or,
// for anything else, in an alert under the form.
//
// Adding, the type's setup help (if any) comes before its settings. A secret
// (a write-only setting) is a password field; editing, one that's stored
// says it's kept if left blank.

/** The placeholder of a secret that's stored. */
export const SECRET_KEPT = "•••• (leave blank to keep)";

export type PrinterFormOutput = {
  name: string;
  driverType: string;
  settings: Settings;
};

/** A driver type's settings fields, or why the form can't show them. */
type TypeFields =
  { ok: true; fields: SettingsField[] } | { ok: false; problem: string };

const NO_FIELDS: SettingsField[] = [];

function typeFields(driverType: DriverType | undefined): TypeFields {
  if (driverType === undefined) return { ok: true, fields: NO_FIELDS };
  try {
    return { ok: true, fields: settingsFields(driverType.settingsSchema) };
  } catch (error) {
    if (!(error instanceof UnsupportedSettingsError)) throw error;
    return { ok: false, problem: error.message };
  }
}

function fieldsOf(
  driverTypes: readonly DriverType[],
  type: string,
): SettingsField[] {
  const found = typeFields(driverTypes.find((each) => each.type === type));
  return found.ok ? found.fields : NO_FIELDS;
}

/** The form's field names. */
type FieldName = "name" | `settings.${string}`;

function formSchema(
  fields: readonly SettingsField[],
  secretsSet: readonly string[],
) {
  return z.object({
    name: PrinterName,
    driverType: z.string().min(1, { error: "Choose a printer type." }),
    settings: settingsSchema(fields, secretsSet),
  });
}

const NO_SECRETS: readonly string[] = [];

export function PrinterForm({
  driverTypes,
  canChooseType,
  initial,
  settingsLocked,
  submitLabel,
  onSubmit,
}: {
  /**
   * The types to choose from (adding, which shows their setup help), or the
   * printer's own (editing).
   */
  driverTypes: readonly DriverType[];
  canChooseType: boolean;
  /** Starting values; the stored settings when editing. */
  initial: {
    name: string;
    driverType: string;
    settings?: Readonly<Record<string, unknown>>;
    /** The secrets that are stored, when editing. */
    secretsSet?: readonly string[];
  };
  /** Why the settings can't change now, if they can't (a job is active). */
  settingsLocked?: string | undefined;
  submitLabel: string;
  /** Sends the form; resolves with the error if it failed. */
  onSubmit: (output: PrinterFormOutput) => Promise<unknown>;
}) {
  const [driverType, setDriverType] = useState(initial.driverType);
  const selected = driverTypes.find((each) => each.type === driverType);
  const current = useMemo(() => typeFields(selected), [selected]);
  const fields = current.ok ? current.fields : NO_FIELDS;
  // Only the printer's own type has stored secrets.
  const secretsSet =
    driverType === initial.driverType
      ? (initial.secretsSet ?? NO_SECRETS)
      : NO_SECRETS;
  const schema = useMemo(
    () => formSchema(fields, secretsSet),
    [fields, secretsSet],
  );
  const [failure, setFailure] = useState<string>();
  const [defaultValues] = useState(() => ({
    name: initial.name,
    driverType: initial.driverType,
    settings: initialValues(
      fieldsOf(driverTypes, initial.driverType),
      initial.settings,
    ),
  }));

  const form = useAppForm({
    defaultValues,
    validationLogic,
    validators: { onDynamic: schema },
    onSubmit: async ({ value }) => {
      setFailure(undefined);
      const error = await onSubmit(schema.parse(value));
      if (error === undefined) return;
      const shown = whereErrorsGo(error, fields);
      // As the schema's own errors, so the next change clears them.
      for (const [name, message] of Object.entries(shown.fields)) {
        form.setFieldMeta(name as FieldName, (meta) => ({
          ...meta,
          errorMap: { ...meta.errorMap, onDynamic: [{ message }] },
          errorSourceMap: { ...meta.errorSourceMap, onDynamic: "form" },
        }));
      }
      setFailure(shown.failure);
    },
  });

  return (
    <form
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        void form.handleSubmit();
      }}
    >
      <FieldGroup>
        <form.AppField name="name">
          {(field) => <field.TextField label="Name" autoComplete="off" />}
        </form.AppField>
        <Field>
          <FieldLabel htmlFor="driverType">Printer type</FieldLabel>
          {canChooseType ? (
            <NativeSelect
              id="driverType"
              className="w-full"
              value={driverType}
              onChange={(event) => {
                const type = event.target.value;
                setDriverType(type);
                form.setFieldValue("driverType", type);
                form.setFieldValue(
                  "settings",
                  initialValues(fieldsOf(driverTypes, type)),
                );
              }}
            >
              {driverTypes.map((each) => (
                <NativeSelectOption key={each.type} value={each.type}>
                  {each.name}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          ) : (
            <p id="driverType" className="text-sm">
              {selected?.name ?? driverType}
            </p>
          )}
          {selected !== undefined && (
            <FieldDescription>{selected.description}</FieldDescription>
          )}
        </Field>
        {canChooseType && selected !== undefined && (
          <SetupHelp steps={selected.setupHelp} />
        )}
        <FieldSeparator />
        {settingsLocked !== undefined && (
          <Alert>
            <AlertDescription>{settingsLocked}</AlertDescription>
          </Alert>
        )}
        {!current.ok && (
          <Alert variant="destructive">
            <AlertDescription>
              This printer type's settings can't be shown. {current.problem}
            </AlertDescription>
          </Alert>
        )}
        {fields.map((setting) => (
          <form.AppField
            key={`${driverType} ${setting.key}`}
            name={`settings.${setting.key}`}
          >
            {(field) => {
              const common = {
                label: setting.label,
                description: setting.description,
                disabled: settingsLocked !== undefined,
              };
              switch (setting.kind) {
                case "boolean":
                  return <field.SwitchField {...common} />;
                case "enum":
                  return (
                    <field.SelectField
                      {...common}
                      options={setting.options.map((option) => ({
                        value: option,
                        label: option,
                      }))}
                      // An optional choice can be left unset.
                      {...(!setting.required && { placeholder: "Not set" })}
                    />
                  );
                case "number":
                  return <field.TextField {...common} inputMode="decimal" />;
                case "string":
                  return setting.writeOnly ? (
                    <field.TextField
                      {...common}
                      type="password"
                      // Not a login: browsers shouldn't fill in a saved one.
                      autoComplete="new-password"
                      {...(isStoredSecret(setting, secretsSet) && {
                        placeholder: SECRET_KEPT,
                      })}
                    />
                  ) : (
                    <field.TextField {...common} />
                  );
              }
            }}
          </form.AppField>
        ))}
        <FormFailure message={failure} />
        <form.AppForm>
          <form.SubmitButton disabled={!current.ok}>
            {submitLabel}
          </form.SubmitButton>
        </form.AppForm>
      </FieldGroup>
    </form>
  );
}

/** What to do on the printer before adding it, as numbered steps. */
function SetupHelp({ steps }: { steps: readonly string[] }) {
  if (steps.length === 0) return null;
  return (
    <section
      aria-labelledby="setup-help"
      className="flex flex-col gap-1 rounded-lg border bg-muted/50 px-3 py-2 text-sm"
    >
      <h2 id="setup-help" className="font-medium">
        Before you add it
      </h2>
      <ol className="list-decimal pl-5 text-muted-foreground">
        {steps.map((step, index) => (
          <li key={index}>{step}</li>
        ))}
      </ol>
    </section>
  );
}

/**
 * Where the server's answer goes: a taken name and invalid settings on their
 * fields; anything else, or settings issues no field matches, in the alert.
 */
function whereErrorsGo(
  error: unknown,
  fields: readonly SettingsField[],
): { fields: Partial<Record<FieldName, string>>; failure: string | undefined } {
  switch (errorCode(error)) {
    case "name_taken":
      return { fields: { name: errorMessage(error) }, failure: undefined };
    case "invalid_settings": {
      const { byKey, unmatched } = serverIssues(
        fields,
        apiError(error)?.details,
      );
      return {
        fields: Object.fromEntries(
          Object.entries(byKey).map(([key, message]) => [
            `settings.${key}`,
            message,
          ]),
        ),
        failure: unmatched ? errorMessage(error) : undefined,
      };
    }
    default:
      return { fields: {}, failure: errorMessage(error) };
  }
}
