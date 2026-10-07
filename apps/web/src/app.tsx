// SPDX-FileCopyrightText: 2026 Open Print Stack contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { QueryClientProvider } from "@tanstack/react-query";
import {
  createRouter,
  type RouterHistory,
  RouterProvider,
} from "@tanstack/react-router";

import { type Api, createApi, signedOutReason } from "./api/client.ts";
import { createQueryClient } from "./api/query-client.ts";
import type { RouterContext } from "./context.ts";
import type { RealtimeSocket, SessionCheck } from "./realtime/client.ts";
import { routeTree } from "./routeTree.gen.ts";

// The whole app: the Query cache, the API client, the realtime settings and
// the router, made once in main.tsx (and once per test, with fakes).

export type AppOptions = {
  /** The page's origin, which serves /api too (through Vite's proxy in dev). */
  origin: string;
  /** For tests. */
  fetch?: typeof fetch;
  /** For tests: a fake WebSocket. */
  createSocket?: (url: string) => RealtimeSocket;
  /** For tests: a memory history. */
  history?: RouterHistory;
  /** For tests. */
  random?: () => number;
  /** For tests. */
  retryDelayMs?: number;
};

export function createApp(options: AppOptions) {
  const queryClient = createQueryClient(
    options.retryDelayMs === undefined
      ? {}
      : { retryDelayMs: options.retryDelayMs },
  );

  const signedOut: RouterContext["signedOut"] = (reason, how = {}) => {
    queryClient.clear();
    if (reason === "setup_required") {
      void router.navigate({ to: "/setup" });
      return;
    }
    const here = router.state.location;
    const returnHere = how.loggedOut !== true && here.pathname !== "/login";
    void router.navigate({
      to: "/login",
      search: returnHere ? { redirect: here.href } : {},
    });
  };

  const api = createApi({
    baseUrl: options.origin,
    ...(options.fetch !== undefined && { fetch: options.fetch }),
    onSignedOut: (reason) => {
      signedOut(reason);
    },
  });

  const context: RouterContext = {
    queryClient,
    api,
    realtime: {
      url: socketUrl(options.origin),
      createSocket: options.createSocket ?? ((url) => new WebSocket(url)),
      checkSession: () => checkSession(api),
      onSignedOut: (reason) => {
        signedOut(reason);
      },
      queryClient,
      ...(options.random !== undefined && { random: options.random }),
    },
    signedOut,
  };

  const router = createRouter({
    routeTree,
    context,
    ...(options.history !== undefined && { history: options.history }),
    scrollRestoration: true,
  });

  return { router, queryClient, api };
}

export type App = ReturnType<typeof createApp>;

declare module "@tanstack/react-router" {
  interface Register {
    router: App["router"];
  }
}

export function AppRoot({ app }: { app: App }) {
  return (
    <QueryClientProvider client={app.queryClient}>
      <RouterProvider router={app.router} />
    </QueryClientProvider>
  );
}

/** ws://host/api/ws, or wss:// for a page served over HTTPS. */
export function socketUrl(origin: string): string {
  const url = new URL("/api/ws", origin);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  return url.href;
}

/** Asks the server whether this page's session is still there. */
async function checkSession(api: Api): Promise<SessionCheck> {
  const { error } = await api.client.GET("/api/auth/me");
  if (error === undefined) return "active";
  return signedOutReason(error) ?? "unknown";
}
