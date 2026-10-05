// SPDX-FileCopyrightText: 2026 Open Print Stack contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { eq, lte } from "drizzle-orm";

import type { Db } from "../client.ts";
import { sessions } from "../schema.ts";

export type Session = typeof sessions.$inferSelect;

export type NewSession = {
  /** sha256 of the session token, never the token itself. */
  id: string;
  userId: string;
  now: number;
  expiresAt: number;
  ip: string | null;
  userAgent: string | null;
};

export class SessionsRepo {
  readonly #db: Db;

  constructor(db: Db) {
    this.#db = db;
  }

  /** The user must exist. Deleting the user deletes their sessions. */
  create(input: NewSession): Session {
    return this.#db
      .insert(sessions)
      .values({
        id: input.id,
        userId: input.userId,
        createdAt: input.now,
        lastSeenAt: input.now,
        expiresAt: input.expiresAt,
        ip: input.ip,
        userAgent: input.userAgent,
      })
      .returning()
      .get();
  }

  findById(id: string): Session | undefined {
    return this.#db.select().from(sessions).where(eq(sessions.id, id)).get();
  }

  /**
   * Deletes every session that has expired by `now` (`expires_at <= now`) and
   * returns how many it deleted. Uses `sessions_expires_at_idx`.
   */
  deleteExpired(now: number): number {
    return this.#db.delete(sessions).where(lte(sessions.expiresAt, now)).run()
      .changes;
  }
}
