// SPDX-FileCopyrightText: 2026 Open Print Stack contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { createRoute } from "@hono/zod-openapi";
import { NewPassword, SessionUser, Username } from "@openprintstack/protocol";
import { z } from "zod";

import { clientKey } from "../../auth/backoff.ts";
import { HttpError } from "../errors.ts";
import {
  clearSessionCookie,
  clientOf,
  requireSession,
  sessionToken,
  setSessionCookie,
} from "../middleware/session.ts";
import {
  errorResponses,
  jsonBody,
  jsonResponse,
  SESSION_SECURITY,
} from "../schemas.ts";
import { newRoutes } from "../validation.ts";

// First-run setup, login, logout and the current user.
//
//   setup   no user yet → admin created, logged in (201); else 409 setup_done
//   login   backoff (429) → user + scrypt (always run) → session (200)
//           or 401 invalid_credentials for any wrong name, password or a
//           disabled user
//   logout  this session deleted, cookie cleared, always 204
//   me      the logged-in user

/** The most of a failed login's username its event keeps, in code points. */
const LOGGED_USERNAME_LENGTH = 64;

const SetupRequest = z
  .object({ username: Username, password: NewPassword })
  .meta({ id: "SetupRequest" });

const LoginRequest = z
  .object({
    username: z.string().trim().min(1),
    password: z.string().min(1),
  })
  .meta({ id: "LoginRequest" });

const UserResponse = z
  .object({ user: SessionUser })
  .meta({ id: "UserResponse" });

const setup = createRoute({
  method: "post",
  path: "/api/auth/setup",
  operationId: "setup",
  tags: ["auth"],
  summary: "Create the admin on first run, and log in",
  description:
    "Only works while no user exists. Sets the ops_session cookie. Publishes auth.setup_completed.",
  request: { body: jsonBody(SetupRequest) },
  responses: {
    201: jsonResponse(UserResponse, "The admin, now logged in."),
    ...errorResponses(400, 409, 413, 415),
  },
});

const login = createRoute({
  method: "post",
  path: "/api/auth/login",
  operationId: "login",
  tags: ["auth"],
  summary: "Log in",
  description:
    "Sets the ops_session cookie. After 5 failed logins from one address, each further failure makes it wait (1 s, doubling to 5 min), during which logins answer 429.",
  request: { body: jsonBody(LoginRequest) },
  responses: {
    200: jsonResponse(UserResponse, "Logged in."),
    ...errorResponses(400, 401, 413, 415, 429),
  },
});

const logout = createRoute({
  method: "post",
  path: "/api/auth/logout",
  operationId: "logout",
  tags: ["auth"],
  summary: "Log out",
  description:
    "Ends this session and clears the cookie. Answers 204 with or without a valid session.",
  responses: {
    204: { description: "Logged out." },
    ...errorResponses(),
  },
});

const me = createRoute({
  method: "get",
  path: "/api/auth/me",
  operationId: "me",
  tags: ["auth"],
  summary: "The logged-in user",
  security: SESSION_SECURITY,
  middleware: requireSession,
  responses: {
    200: jsonResponse(UserResponse, "The logged-in user."),
    ...errorResponses(401),
  },
});

export function authRoutes() {
  const routes = newRoutes();

  routes.openapi(setup, async (c) => {
    const { deps } = c.var;
    const { username, password } = c.req.valid("json");
    if (deps.repos.users.count() > 0) throw setupDone();
    const passwordHash = await deps.passwords.hash(password);
    // Checked again with the insert: another setup may have run meanwhile.
    const user = deps.repos.users.createFirst({
      username,
      passwordHash,
      now: deps.now(),
    });
    if (user === undefined) throw setupDone();
    const session = deps.sessions.create(user.id, clientOf(c));
    setSessionCookie(c, session.token);
    deps.bus.publish({
      type: "auth.setup_completed",
      printerId: null,
      source: { kind: "user", userId: user.id },
      payload: {},
    });
    return c.json({ user: { id: user.id, username: user.username } }, 201);
  });

  routes.openapi(login, async (c) => {
    const { deps } = c.var;
    const { username, password } = c.req.valid("json");
    const client = clientOf(c);
    const key = clientKey(client.ip);
    const waitMs = deps.backoff.retryAfterMs(key, deps.now());
    if (waitMs > 0) {
      const seconds = Math.ceil(waitMs / 1000);
      throw new HttpError(
        "too_many_attempts",
        `Too many failed logins. Try again in ${seconds} s.`,
        { headers: { "Retry-After": String(seconds) } },
      );
    }

    const user = deps.repos.users.findByUsername(username);
    // A missing user still costs a full scrypt check, so timing doesn't tell.
    const { ok, rehash } =
      user === undefined
        ? await deps.passwords.verifyNobody(password)
        : await deps.passwords.verify(password, user.passwordHash);
    const now = deps.now();
    if (user === undefined || !ok || user.disabledAt !== null) {
      deps.backoff.recordFailure(key, now);
      deps.bus.publish({
        type: "auth.login_failed",
        printerId: null,
        source: { kind: "system" },
        payload: {
          username: [...username].slice(0, LOGGED_USERNAME_LENGTH).join(""),
        },
      });
      throw new HttpError(
        "invalid_credentials",
        "The username or password is wrong.",
      );
    }

    deps.backoff.recordSuccess(key);
    if (rehash) {
      deps.repos.users.updatePasswordHash(
        user.id,
        await deps.passwords.hash(password),
        now,
      );
    }
    deps.repos.users.recordLogin(user.id, now);
    const session = deps.sessions.create(user.id, client);
    setSessionCookie(c, session.token);
    deps.bus.publish({
      type: "auth.login_succeeded",
      printerId: null,
      source: { kind: "user", userId: user.id },
      payload: {},
    });
    return c.json({ user: { id: user.id, username: user.username } }, 200);
  });

  routes.openapi(logout, (c) => {
    const { deps } = c.var;
    const ended = deps.sessions.end(sessionToken(c));
    clearSessionCookie(c);
    if (ended !== undefined) {
      deps.bus.publish({
        type: "auth.logout",
        printerId: null,
        source: { kind: "user", userId: ended.user.id },
        payload: {},
      });
    }
    return c.body(null, 204);
  });

  routes.openapi(me, (c) => c.json({ user: c.var.user }, 200));

  return routes;
}

function setupDone(): HttpError {
  return new HttpError("setup_done", "Setup has already been done.");
}
