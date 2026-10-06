// SPDX-FileCopyrightText: 2026 Open Print Stack contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { count, eq, inArray } from "drizzle-orm";

import { newId } from "../../ids.ts";
import type { Db } from "../client.ts";
import { UserRole, users } from "../schema.ts";

export type User = typeof users.$inferSelect;

export type NewUser = {
  username: string;
  /** A PHC-style scrypt string. */
  passwordHash: string;
  now: number;
};

export class UsersRepo {
  readonly #db: Db;

  constructor(db: Db) {
    this.#db = db;
  }

  /** Creates an admin. A username that differs only in case is taken. */
  create(input: NewUser): User {
    return toUser(
      this.#db.insert(users).values(newUserRow(input)).returning().get(),
    );
  }

  /**
   * Creates the first user, as first-run setup does, or returns undefined if
   * there already is one. The check and the insert run in one transaction.
   */
  createFirst(input: NewUser): User | undefined {
    return this.#db.transaction((tx) => {
      const existing = tx.select({ id: users.id }).from(users).limit(1).get();
      if (existing !== undefined) return undefined;
      return toUser(
        tx.insert(users).values(newUserRow(input)).returning().get(),
      );
    });
  }

  /** How many users there are. */
  count(): number {
    return this.#db.select({ count: count() }).from(users).get()?.count ?? 0;
  }

  findById(id: string): User | undefined {
    const row = this.#db.select().from(users).where(eq(users.id, id)).get();
    return row && toUser(row);
  }

  /** Ignores case: "ROB" finds "rob". */
  findByUsername(username: string): User | undefined {
    const row = this.#db
      .select()
      .from(users)
      .where(eq(users.username, username))
      .get();
    return row && toUser(row);
  }

  /** Each user's username, by id. Ids with no user are left out. */
  usernames(ids: readonly string[]): Map<string, string> {
    const unique = [...new Set(ids)];
    if (unique.length === 0) return new Map();
    const rows = this.#db
      .select({ id: users.id, username: users.username })
      .from(users)
      .where(inArray(users.id, unique))
      .all();
    return new Map(rows.map((row) => [row.id, row.username]));
  }

  /** Records a successful login. Returns whether there was such a user. */
  recordLogin(id: string, now: number): boolean {
    return (
      this.#db
        .update(users)
        .set({ lastLoginAt: now })
        .where(eq(users.id, id))
        .run().changes > 0
    );
  }

  /**
   * Replaces the password hash, e.g. with one made with newer scrypt
   * settings. Returns whether there was such a user.
   */
  updatePasswordHash(id: string, passwordHash: string, now: number): boolean {
    return (
      this.#db
        .update(users)
        .set({ passwordHash, updatedAt: now })
        .where(eq(users.id, id))
        .run().changes > 0
    );
  }
}

function newUserRow(input: NewUser): typeof users.$inferInsert {
  return {
    id: newId(),
    username: input.username,
    passwordHash: input.passwordHash,
    role: "admin",
    createdAt: input.now,
    updatedAt: input.now,
  };
}

/** The column is plain text, so the role is checked on the way out. */
function toUser(row: User): User {
  return { ...row, role: UserRole.parse(row.role) };
}
