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
  FieldDescription,
  FieldError,
  FieldLabel,
} from "./ui/field.tsx";
import { Input } from "./ui/input.tsx";

// TanStack Form wired to shadcn's field primitives. Forms use `useAppForm`
// and render `<form.AppField name="…">{(field) => <field.TextField … />}`,
// so each field gets its label, aria-invalid and error messages the same way.
//
// Validation runs on the first submit, then on every change after it
// (`validationLogic`): no errors while someone is still typing their first
// attempt. Give the form's schema as `validators.onDynamic`.

export const { fieldContext, formContext, useFieldContext, useFormContext } =
  createFormHookContexts();

/** Validate on submit, then on change once submitted. */
export const validationLogic = revalidateLogic();

function TextField({
  label,
  type = "text",
  autoComplete,
  description,
}: {
  label: string;
  type?: "text" | "password";
  autoComplete?: string;
  description?: ReactNode;
}) {
  const field = useFieldContext<string>();
  const invalid = field.state.meta.isTouched && !field.state.meta.isValid;
  return (
    <Field data-invalid={invalid}>
      <FieldLabel htmlFor={field.name}>{label}</FieldLabel>
      <Input
        id={field.name}
        name={field.name}
        type={type}
        autoComplete={autoComplete}
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

function SubmitButton({ children }: { children: ReactNode }) {
  const form = useFormContext();
  return (
    <form.Subscribe selector={(state) => state.isSubmitting}>
      {(isSubmitting) => (
        <Button type="submit" disabled={isSubmitting}>
          {children}
        </Button>
      )}
    </form.Subscribe>
  );
}

export const { useAppForm } = createFormHook({
  fieldContext,
  formContext,
  fieldComponents: { TextField },
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
