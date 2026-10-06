// SPDX-FileCopyrightText: 2026 Open Print Stack contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { SessionUser } from "@openprintstack/protocol";
import type { QueryClient } from "@tanstack/react-query";

import { type Api, type SignedOutReason, signedOutReason } from "./client.ts";

// Who is logged in, from GET /api/auth/me. The answer is cached until the
// session ends (logout, or a 401 elsewhere), which clears the whole cache;
// login and setup put their answer in it directly.

export type SessionStatus =
  { kind: "active"; user: SessionUser } | { kind: SignedOutReason };

export function sessionQuery(api: Api) {
  return api.query.queryOptions("get", "/api/auth/me", undefined, {
    staleTime: Infinity,
  });
}

/**
 * Whether there's a session, from the cache or the server. Throws if the
 * server can't say (unreachable or failing), after the usual retries.
 */
export async function sessionStatus(context: {
  queryClient: QueryClient;
  api: Api;
}): Promise<SessionStatus> {
  try {
    const { user } = await context.queryClient.ensureQueryData(
      sessionQuery(context.api),
    );
    return { kind: "active", user };
  } catch (error) {
    const reason = signedOutReason(error);
    if (reason !== undefined) return { kind: reason };
    throw error;
  }
}
