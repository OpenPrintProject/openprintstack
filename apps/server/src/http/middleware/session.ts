// SPDX-FileCopyrightText: 2026 Open Print Stack contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { Context, MiddlewareHandler } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";

import { SESSION_COOKIE, SESSION_TTL_MS } from "../../auth/sessions.ts";
import type { AppEnv, SessionEnv } from "../context.ts";
import { errorResponse, HttpError } from "../errors.ts";

// The `ops_session` cookie: HttpOnly, SameSite=Lax, Path=/, 7 days. No Secure
// flag until Phase 8 adds HTTPS: browsers won't send a Secure cookie over
// plain HTTP to a LAN address.

const COOKIE = { httpOnly: true, sameSite: "Lax", path: "/" } as const;

export function setSessionCookie(c: Context, token: string): void {
  setCookie(c, SESSION_COOKIE, token, {
    ...COOKIE,
    maxAge: SESSION_TTL_MS / 1000,
  });
}

/** Tells the browser to drop the cookie (Max-Age=0). */
export function clearSessionCookie(c: Context): void {
  deleteCookie(c, SESSION_COOKIE, COOKIE);
}

/** The session cookie's token, if the request has one. */
export function sessionToken(c: Context): string | undefined {
  return getCookie(c, SESSION_COOKIE);
}

/** The client's address and user agent, for a new session. */
export function clientOf(c: Context<AppEnv>): {
  ip: string | null;
  userAgent: string | null;
} {
  return {
    ip: c.env?.incoming?.socket.remoteAddress ?? null,
    userAgent: c.req.header("user-agent") ?? null,
  };
}

/**
 * Lets a request through only with a valid session, setting `user` and
 * `sessionId`. Otherwise 401: setup_required while no user exists, else
 * unauthenticated, and a cookie that's no longer valid is cleared. When the
 * request slides the session's expiry, the cookie is sent again.
 */
export const requireSession: MiddlewareHandler<SessionEnv> = async (
  c,
  next,
) => {
  const { deps } = c.var;
  const token = sessionToken(c);
  const session = deps.sessions.authenticate(token);
  if (session === undefined) {
    if (token !== undefined) clearSessionCookie(c);
    return errorResponse(
      c,
      deps.repos.users.count() === 0
        ? new HttpError(
            "setup_required",
            "No user exists yet: create the admin first.",
          )
        : new HttpError("unauthenticated", "Log in first."),
    );
  }
  if (session.renewed && token !== undefined) {
    setSessionCookie(c, token);
  }
  c.set("user", session.user);
  c.set("sessionId", session.sessionId);
  await next();
};
