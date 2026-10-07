// SPDX-FileCopyrightText: 2026 Open Print Stack contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  createFormHook,
  createFormHookContexts,
  revalidateLogic,
} from "@tanstack/react-form";
import type { ReactNode } from "react";

import { Alert, AlertDescription } from "./ui/alert.tsx";
import { Button } from "./ui/button.tsx";
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldError,
  FieldLabel,
} from "./ui/field.tsx";
import { Input } from "./ui/input.tsx";
import { NativeSelect, NativeSelectOption } from "./ui/native-select.tsx";
import { Spinner } from "./ui/spinner.tsx";
import { Switch } from "./ui/switch.tsx";

// TanStack Form wired to shadcn's field primitives. Forms use `useAppForm`
// and render `<form.AppField name="…">{(field) => <field.TextField … />}`
// (or SwitchField, SelectField), so each field gets its label, aria-invalid
// and error messages the same way.
//
// Validation runs on the first submit, then on every change after it
// (`validationLogic`): no errors while someone is still typing their first
// attempt. Give the form's schema as `validators.onDynamic`.

export const { fieldContext, formContext, useFieldContext, useFormContext } =
  createFormHookContexts();

/** Validate on submit, then on change once submitted. */
export const validationLogic = revalidateLogic();

/** Whether the field should show its errors: touched, and invalid. */
function useShowErrors(): boolean {
  const field = useFieldContext<unknown>();
  return field.state.meta.isTouched && !field.state.meta.isValid;
}

function TextField({
  label,
  type = "text",
  autoComplete,
  inputMode,
  description,
  disabled,
}: {
  label: string;
  type?: "text" | "password";
  autoComplete?: string;
  /** "decimal" for a number: a text field, so the value is what was typed. */
  inputMode?: "decimal";
  description?: ReactNode;
  disabled?: boolean;
}) {
  const field = useFieldContext<string>();
  const invalid = useShowErrors();
  return (
    <Field data-invalid={invalid} data-disabled={disabled}>
      <FieldLabel htmlFor={field.name}>{label}</FieldLabel>
      <Input
        id={field.name}
        name={field.name}
        type={type}
        autoComplete={autoComplete}
        inputMode={inputMode}
        disabled={disabled}
        value={field.state.value}
        onBlur={field.handleBlur}
        onChange={(event) => {
          field.handleChange(event.target.value);
        }}
        aria-invalid={invalid}
      />
      {description !== undefined && (
        <FieldDescription>{description}</FieldDescription>
      )}
      {invalid && <FieldError errors={field.state.meta.errors} />}
    </Field>
  );
}

function SwitchField({
  label,
  description,
  disabled,
}: {
  label: string;
  description?: ReactNode;
  disabled?: boolean;
}) {
  const field = useFieldContext<boolean>();
  const invalid = useShowErrors();
  return (
    <Field
      orientation="horizontal"
      data-invalid={invalid}
      data-disabled={disabled}
    >
      <FieldContent>
        <FieldLabel htmlFor={field.name}>{label}</FieldLabel>
        {description !== undefined && (
          <FieldDescription>{description}</FieldDescription>
        )}
        {invalid && <FieldError errors={field.state.meta.errors} />}
      </FieldContent>
      <Switch
        id={field.name}
        name={field.name}
        disabled={disabled}
        checked={field.state.value}
        onBlur={field.handleBlur}
        onCheckedChange={(checked) => {
          field.handleChange(checked);
        }}
        aria-invalid={invalid}
      />
    </Field>
  );
}

function SelectField({
  label,
  options,
  placeholder,
  description,
  disabled,
}: {
  label: string;
  options: readonly { value: string; label: string }[];
  /** The empty choice's text, for a field that may be left unset. */
  placeholder?: string;
  description?: ReactNode;
  disabled?: boolean;
}) {
  const field = useFieldContext<string>();
  const invalid = useShowErrors();
  return (
    <Field data-invalid={invalid} data-disabled={disabled}>
      <FieldLabel htmlFor={field.name}>{label}</FieldLabel>
      <NativeSelect
        id={field.name}
        name={field.name}
        className="w-full"
        disabled={disabled}
        value={field.state.value}
        onBlur={field.handleBlur}
        onChange={(event) => {
          field.handleChange(event.target.value);
        }}
        aria-invalid={invalid}
      >
        {placeholder !== undefined && (
          <NativeSelectOption value="">{placeholder}</NativeSelectOption>
        )}
        {options.map((option) => (
          <NativeSelectOption key={option.value} value={option.value}>
            {option.label}
          </NativeSelectOption>
        ))}
      </NativeSelect>
      {description !== undefined && (
        <FieldDescription>{description}</FieldDescription>
      )}
      {invalid && <FieldError errors={field.state.meta.errors} />}
    </Field>
  );
}

function SubmitButton({
  children,
  disabled = false,
}: {
  children: ReactNode;
  disabled?: boolean;
}) {
  const form = useFormContext();
  return (
    <form.Subscribe selector={(state) => state.isSubmitting}>
      {(isSubmitting) => (
        <Button type="submit" disabled={disabled || isSubmitting}>
          {isSubmitting && <Spinner data-icon="inline-start" aria-hidden />}
          {children}
        </Button>
      )}
    </form.Subscribe>
  );
}

export const { useAppForm } = createFormHook({
  fieldContext,
  formContext,
  fieldComponents: { TextField, SwitchField, SelectField },
  formComponents: { SubmitButton },
});

/** What went wrong with a submit that the fields can't show (the server's answer). */
export function FormFailure({ message }: { message: string | undefined }) {
  if (message === undefined) return null;
  return (
    <Alert variant="destructive">
      <AlertDescription>{message}</AlertDescription>
    </Alert>
  );
}
