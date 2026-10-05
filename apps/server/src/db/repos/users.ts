// SPDX-FileCopyrightText: 2026 Open Print Stack contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { eq } from "drizzle-orm";

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
    const row = this.#db
      .insert(users)
      .values({
        id: newId(),
        username: input.username,
        passwordHash: input.passwordHash,
        role: "admin",
        createdAt: input.now,
        updatedAt: input.now,
      })
      .returning()
      .get();
    return toUser(row);
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
}

/** The column is plain text, so the role is checked on the way out. */
function toUser(row: User): User {
  return { ...row, role: UserRole.parse(row.role) };
}
