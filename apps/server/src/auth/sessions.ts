// SPDX-FileCopyrightText: 2026 Open Print Stack contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { createHash, randomBytes } from "node:crypto";

import type { SessionUser } from "@openprintstack/protocol";

import type { SessionsRepo, UsersRepo } from "../db/repos/index.ts";

// Login sessions. The token (32 random bytes, base64url) only ever lives in
// the browser's `ops_session` cookie; the database stores its sha256 as the
// session id. Sessions last 7 days from the last request: the expiry slides
// forward, but is written to the database at most once an hour.

export const SESSION_COOKIE = "ops_session";

/** How long a session lasts after its last request. */
export const SESSION_TTL_MS = 7 * 24 * 60 * 60_000;

/** The expiry is written to the database at most this often per session. */
export const SESSION_TOUCH_INTERVAL_MS = 60 * 60_000;

const TOKEN_BYTES = 32;

/** 32 bytes in unpadded base64url. Anything else is never looked up. */
const TOKEN = /^[A-Za-z0-9_-]{43}$/;

/** User agents are cut to this many characters before they're stored. */
const MAX_USER_AGENT = 512;

/** The session id for a token: its sha256, in hex. */
export function sessionIdOf(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export type NewSession = {
  /** The token for the cookie. It isn't stored anywhere. */
  readonly token: string;
  readonly sessionId: string;
  readonly expiresAt: number;
};

/** A valid session, found from its token. */
export type AuthenticatedSession = {
  readonly user: SessionUser;
  readonly sessionId: string;
  readonly expiresAt: number;
  /**
   * This request slid the expiry and wrote it to the database, so the cookie
   * should be sent again with a fresh Max-Age.
   */
  readonly renewed: boolean;
};

export type SessionServiceOptions = {
  sessions: SessionsRepo;
  users: UsersRepo;
  /** The time in milliseconds. `Date.now` by default. */
  now?: () => number;
};

/** Called with the id of every session this service deletes. */
export type SessionEndedListener = (sessionId: string) => void;

export class SessionService {
  readonly #sessions: SessionsRepo;
  readonly #users: UsersRepo;
  readonly #now: () => number;
  readonly #listeners = new Set<SessionEndedListener>();

  constructor(options: SessionServiceOptions) {
    this.#sessions = options.sessions;
    this.#users = options.users;
    this.#now = options.now ?? (() => Date.now());
  }

  /** Starts a session for the user, lasting `SESSION_TTL_MS`. */
  create(
    userId: string,
    client: { ip: string | null; userAgent: string | null },
  ): NewSession {
    const token = randomBytes(TOKEN_BYTES).toString("base64url");
    const now = this.#now();
    const session = this.#sessions.create({
      id: sessionIdOf(token),
      userId,
      now,
      expiresAt: now + SESSION_TTL_MS,
      ip: client.ip,
      userAgent: client.userAgent?.slice(0, MAX_USER_AGENT) ?? null,
    });
    return { token, sessionId: session.id, expiresAt: session.expiresAt };
  }

  /**
   * The session for a cookie's token, or undefined if there's no valid one.
   * Slides the expiry when the session was last written an hour or more ago.
   * An expired session is deleted, and so is every session of a disabled or
   * deleted user.
   */
  authenticate(token: string | undefined): AuthenticatedSession | undefined {
    if (token === undefined || !TOKEN.test(token)) return undefined;
    const sessionId = sessionIdOf(token);
    const session = this.#sessions.findById(sessionId);
    if (session === undefined) return undefined;

    const now = this.#now();
    if (session.expiresAt <= now) {
      this.#sessions.delete(sessionId);
      this.#ended([sessionId]);
      return undefined;
    }
    const user = this.#users.findById(session.userId);
    if (user === undefined) {
      this.#sessions.delete(sessionId);
      this.#ended([sessionId]);
      return undefined;
    }
    if (user.disabledAt !== null) {
      this.#ended(this.#sessions.deleteForUser(user.id));
      return undefined;
    }

    let expiresAt = session.expiresAt;
    const renewed = now - session.lastSeenAt >= SESSION_TOUCH_INTERVAL_MS;
    if (renewed) {
      expiresAt = now + SESSION_TTL_MS;
      this.#sessions.touch(sessionId, { now, expiresAt });
    }
    return {
      user: { id: user.id, username: user.username },
      sessionId,
      expiresAt,
      renewed,
    };
  }

  /**
   * Logs out: deletes the token's session, and returns it if it was valid.
   * An expired or unknown token is deleted too, but returns undefined.
   */
  end(token: string | undefined): AuthenticatedSession | undefined {
    const session = this.authenticate(token);
    if (session !== undefined) {
      this.#sessions.delete(session.sessionId);
      this.#ended([session.sessionId]);
    } else if (token !== undefined && TOKEN.test(token)) {
      this.#sessions.delete(sessionIdOf(token));
    }
    return session;
  }

  /**
   * Calls `listener` with the id of each session this service deletes (logout,
   * expiry found on a request, a disabled user). The pruner's deletions of
   * expired sessions aren't reported. A listener must not throw: it runs
   * inside the request that ended the session. Returns a function that stops
   * it.
   */
  onSessionEnded(listener: SessionEndedListener): () => void {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  }

  #ended(sessionIds: readonly string[]): void {
    for (const sessionId of sessionIds) {
      for (const listener of [...this.#listeners]) {
        listener(sessionId);
      }
    }
  }
}
