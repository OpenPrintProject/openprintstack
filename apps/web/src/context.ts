// SPDX-FileCopyrightText: 2026 Open Print Stack contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { QueryClient } from "@tanstack/react-query";

import type { Api, SignedOutReason } from "./api/client.ts";
import type { RealtimeSettings } from "./realtime/provider.tsx";

/** What every route gets from the router (`context` in TanStack Router). */
export type RouterContext = {
  queryClient: QueryClient;
  api: Api;
  realtime: RealtimeSettings;
  /**
   * Ends the session in this tab: forgets every cached answer and shows
   * /setup or /login. Unless it was a logout, /login brings you back to the
   * page you were on.
   */
  signedOut: (reason: SignedOutReason, how?: { loggedOut?: boolean }) => void;
};
