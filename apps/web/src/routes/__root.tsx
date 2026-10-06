// SPDX-FileCopyrightText: 2026 Open Print Stack contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  createRootRouteWithContext,
  type ErrorComponentProps,
  Link,
  Outlet,
  useRouter,
} from "@tanstack/react-router";

import { errorMessage } from "../api/errors.ts";
import { AuthCard } from "../components/auth-card.tsx";
import { Button } from "../components/ui/button.tsx";
import type { RouterContext } from "../context.ts";

export const Route = createRootRouteWithContext<RouterContext>()({
  component: Outlet,
  errorComponent: RootError,
  notFoundComponent: NotFound,
});

/** A route failed to load, e.g. the server couldn't be reached. */
function RootError({ error, reset }: ErrorComponentProps) {
  const router = useRouter();
  return (
    <AuthCard title="Something went wrong" description={errorMessage(error)}>
      <Button
        onClick={() => {
          reset();
          void router.invalidate();
        }}
      >
        Try again
      </Button>
    </AuthCard>
  );
}

function NotFound() {
  return (
    <AuthCard
      title="Page not found"
      description="There's nothing at this address."
    >
      <Button asChild>
        <Link to="/">Go to the printers</Link>
      </Button>
    </AuthCard>
  );
}
