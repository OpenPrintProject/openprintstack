// SPDX-FileCopyrightText: 2026 Open Print Stack contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { PASSWORD_MIN_LENGTH } from "@openprintstack/protocol";
import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import { useState } from "react";

import { errorCode, errorMessage } from "../api/errors.ts";
import { sessionQuery, sessionStatus } from "../api/session.ts";
import { SetupForm } from "../auth/forms.ts";
import { AuthCard } from "../components/auth-card.tsx";
import {
  FormFailure,
  useAppForm,
  validationLogic,
} from "../components/form.tsx";
import { FieldGroup } from "../components/ui/field.tsx";

// First run: create the admin account. Only while no user exists; the server
// refuses it (409) afterwards.

export const Route = createFileRoute("/setup")({
  beforeLoad: async ({ context }) => {
    const status = await sessionStatus(context);
    if (status.kind === "active") throw redirect({ to: "/" });
    if (status.kind === "unauthenticated") throw redirect({ to: "/login" });
  },
  component: SetupPage,
});

function SetupPage() {
  const { api, queryClient } = Route.useRouteContext();
  const navigate = Route.useNavigate();
  const [failure, setFailure] = useState<string>();
  const [setupDone, setSetupDone] = useState(false);

  const form = useAppForm({
    defaultValues: { username: "", password: "", confirm: "" },
    validationLogic,
    validators: { onDynamic: SetupForm },
    onSubmit: async ({ value }) => {
      setFailure(undefined);
      try {
        const { data, error } = await api.client.POST("/api/auth/setup", {
          body: { username: value.username, password: value.password },
        });
        if (error !== undefined) {
          setSetupDone(errorCode(error) === "setup_done");
          setFailure(errorMessage(error));
          return;
        }
        queryClient.setQueryData(sessionQuery(api).queryKey, data);
        await navigate({ to: "/" });
      } catch (error) {
        setFailure(errorMessage(error));
      }
    },
  });

  return (
    <AuthCard
      title="Welcome to Open Print Stack"
      description="Create the admin account. There's no way to reset the password yet, so keep it somewhere safe."
    >
      <form
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          void form.handleSubmit();
        }}
      >
        <FieldGroup>
          <form.AppField name="username">
            {(field) => (
              <field.TextField
                label="Username"
                autoComplete="username"
                description="Letters, digits, dots, underscores and hyphens."
              />
            )}
          </form.AppField>
          <form.AppField name="password">
            {(field) => (
              <field.TextField
                label="Password"
                type="password"
                autoComplete="new-password"
                description={`At least ${PASSWORD_MIN_LENGTH} characters.`}
              />
            )}
          </form.AppField>
          <form.AppField name="confirm">
            {(field) => (
              <field.TextField
                label="Confirm password"
                type="password"
                autoComplete="new-password"
              />
            )}
          </form.AppField>
          <FormFailure message={failure} />
          {setupDone && (
            <Link to="/login" className="text-sm underline underline-offset-4">
              Go to the login page
            </Link>
          )}
          <form.AppForm>
            <form.SubmitButton>Create the admin account</form.SubmitButton>
          </form.AppForm>
        </FieldGroup>
      </form>
    </AuthCard>
  );
}
