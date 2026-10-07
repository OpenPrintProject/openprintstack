// SPDX-FileCopyrightText: 2026 Open Print Stack contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { createFileRoute, redirect } from "@tanstack/react-router";
import { useState } from "react";
import { z } from "zod";

import { errorMessage } from "../api/errors.ts";
import { sessionQuery, sessionStatus } from "../api/session.ts";
import { LoginForm } from "../auth/forms.ts";
import { AuthCard } from "../components/auth-card.tsx";
import {
  FormFailure,
  useAppForm,
  validationLogic,
} from "../components/form.tsx";
import { FieldGroup } from "../components/ui/field.tsx";
import { safeRedirect } from "../navigation.ts";

// /login?redirect=/the/page/you/were/on

const LoginSearch = z.object({
  redirect: z.string().optional().catch(undefined),
});

export const Route = createFileRoute("/login")({
  validateSearch: LoginSearch,
  beforeLoad: async ({ context, search }) => {
    const status = await sessionStatus(context);
    if (status.kind === "active") {
      throw redirect({ href: safeRedirect(search.redirect) });
    }
    if (status.kind === "setup_required") throw redirect({ to: "/setup" });
  },
  component: LoginPage,
});

function LoginPage() {
  const { api, queryClient } = Route.useRouteContext();
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const [failure, setFailure] = useState<string>();

  const form = useAppForm({
    defaultValues: { username: "", password: "" },
    validationLogic,
    validators: { onDynamic: LoginForm },
    onSubmit: async ({ value }) => {
      setFailure(undefined);
      try {
        const { data, error } = await api.client.POST("/api/auth/login", {
          body: value,
        });
        if (error !== undefined) {
          setFailure(errorMessage(error));
          return;
        }
        queryClient.setQueryData(sessionQuery(api).queryKey, data);
        await navigate({ href: safeRedirect(search.redirect) });
      } catch (error) {
        setFailure(errorMessage(error));
      }
    },
  });

  return (
    <AuthCard title="Log in to Open Print Stack">
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
              <field.TextField label="Username" autoComplete="username" />
            )}
          </form.AppField>
          <form.AppField name="password">
            {(field) => (
              <field.TextField
                label="Password"
                type="password"
                autoComplete="current-password"
              />
            )}
          </form.AppField>
          <FormFailure message={failure} />
          <form.AppForm>
            <form.SubmitButton>Log in</form.SubmitButton>
          </form.AppForm>
        </FieldGroup>
      </form>
    </AuthCard>
  );
}
