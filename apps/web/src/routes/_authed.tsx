// SPDX-FileCopyrightText: 2026 Open Print Stack contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  createFileRoute,
  Link,
  Outlet,
  redirect,
} from "@tanstack/react-router";
import { LogOutIcon } from "lucide-react";

import { errorMessage } from "../api/errors.ts";
import { sessionStatus } from "../api/session.ts";
import { ConnectionStatus } from "../components/connection-status.tsx";
import { Button } from "../components/ui/button.tsx";
import { Toaster } from "../components/ui/sonner.tsx";
import { EventToasts } from "../printers/event-toasts.tsx";
import { RealtimeProvider, useRealtime } from "../realtime/provider.tsx";

// Every page behind the login. The guard sends you to /setup or /login (and
// back here afterwards); the layout holds the page's realtime connection, the
// header, and the toasts (with those for every printer's events).

export const Route = createFileRoute("/_authed")({
  beforeLoad: async ({ context, location }) => {
    const status = await sessionStatus(context);
    if (status.kind === "active") return { user: status.user };
    if (status.kind === "setup_required") throw redirect({ to: "/setup" });
    throw redirect({ to: "/login", search: { redirect: location.href } });
  },
  component: AuthedLayout,
});

function AuthedLayout() {
  const { realtime } = Route.useRouteContext();
  return (
    <RealtimeProvider settings={realtime}>
      <div className="min-h-svh">
        <Header />
        <main className="mx-auto w-full max-w-5xl p-4">
          <Outlet />
        </main>
      </div>
      <EventToasts />
      <Toaster />
    </RealtimeProvider>
  );
}

function Header() {
  const { user } = Route.useRouteContext();
  const logout = useLogout();
  return (
    <header className="border-b">
      <div className="mx-auto flex w-full max-w-5xl flex-wrap items-center gap-x-4 gap-y-2 p-4">
        <Link to="/" className="font-heading font-semibold">
          Open Print Stack
        </Link>
        <ConnectionStatus />
        <div className="ml-auto flex items-center gap-3">
          <span className="text-sm text-muted-foreground">{user.username}</span>
          <Button
            variant="outline"
            disabled={logout.isPending}
            onClick={() => {
              logout.mutate();
            }}
          >
            <LogOutIcon data-icon="inline-start" />
            Log out
          </Button>
        </div>
        {logout.error !== null && (
          <p role="alert" className="w-full text-sm text-destructive">
            Couldn't log out: {errorMessage(logout.error)}
          </p>
        )}
      </div>
    </header>
  );
}

/**
 * Logs out. The socket is closed first, so the server's 4401 for this session
 * isn't taken for an expiry; if logging out fails, it reconnects.
 */
function useLogout() {
  const { api, signedOut } = Route.useRouteContext();
  const realtime = useRealtime();
  return api.query.useMutation("post", "/api/auth/logout", {
    onMutate: () => {
      realtime.stop();
    },
    onSuccess: () => {
      signedOut("unauthenticated", { loggedOut: true });
    },
    onError: () => {
      realtime.start();
    },
  });
}
