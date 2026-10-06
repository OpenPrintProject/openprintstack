// SPDX-FileCopyrightText: 2026 Open Print Stack contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from "vitest";
import { z } from "zod";

import { testDatabase } from "../../test-utils.ts";
import { UsersRepo } from "./users.ts";

const HASH = "$scrypt$ln=17,r=8,p=1$c2FsdA$aGFzaA";

async function repo(): Promise<UsersRepo> {
  return new UsersRepo(await testDatabase());
}

describe("UsersRepo", () => {
  it("creates an admin with a UUIDv7 and the given times", async () => {
    const users = await repo();

    const user = users.create({
      username: "Rob",
      passwordHash: HASH,
      now: 1000,
    });

    const { id, ...rest } = user;
    expect(z.uuidv7().safeParse(id).success).toBe(true);
    expect(rest).toEqual({
      username: "Rob",
      passwordHash: HASH,
      role: "admin",
      createdAt: 1000,
      updatedAt: 1000,
      lastLoginAt: null,
      disabledAt: null,
    });
  });

  it("finds a user by id", async () => {
    const users = await repo();
    const user = users.create({ username: "rob", passwordHash: HASH, now: 1 });

    expect(users.findById(user.id)).toEqual(user);
    expect(users.findById("nobody")).toBeUndefined();
  });

  it("finds a username ignoring case, keeping the stored casing", async () => {
    const users = await repo();
    const user = users.create({ username: "Rob", passwordHash: HASH, now: 1 });

    expect(users.findByUsername("rob")).toEqual(user);
    expect(users.findByUsername("ROB")?.username).toBe("Rob");
    expect(users.findByUsername("bob")).toBeUndefined();
  });

  it("refuses a username that differs only in case", async () => {
    const users = await repo();
    users.create({ username: "rob", passwordHash: HASH, now: 1 });

    expect(() =>
      users.create({ username: "ROB", passwordHash: HASH, now: 2 }),
    ).toThrow(
      expect.objectContaining({
        code: "SQLITE_CONSTRAINT_UNIQUE",
        message: "UNIQUE constraint failed: users.username",
      }),
    );
  });

  it("folds only ASCII case, as SQLite's NOCASE does", async () => {
    const users = await repo();
    users.create({ username: "émile", passwordHash: HASH, now: 1 });

    expect(() =>
      users.create({ username: "Émile", passwordHash: HASH, now: 1 }),
    ).not.toThrow();
    expect(users.findByUsername("ÉMILE")?.username).toBe("Émile");
  });

  it("creates the first user only while there is none", async () => {
    const users = await repo();

    const first = users.createFirst({
      username: "rob",
      passwordHash: HASH,
      now: 1,
    });

    expect(first?.username).toBe("rob");
    expect(users.findById(first?.id ?? "")).toEqual(first);
    expect(
      users.createFirst({ username: "sam", passwordHash: HASH, now: 2 }),
    ).toBeUndefined();
    expect(users.findByUsername("sam")).toBeUndefined();
    expect(users.count()).toBe(1);
  });

  it("counts users", async () => {
    const users = await repo();
    expect(users.count()).toBe(0);

    users.create({ username: "rob", passwordHash: HASH, now: 1 });
    users.create({ username: "sam", passwordHash: HASH, now: 1 });

    expect(users.count()).toBe(2);
  });

  it("looks up usernames by id, leaving out ids with no user", async () => {
    const users = await repo();
    const rob = users.create({ username: "Rob", passwordHash: HASH, now: 1 });
    const sam = users.create({ username: "sam", passwordHash: HASH, now: 1 });
    users.create({ username: "kim", passwordHash: HASH, now: 1 });

    expect(users.usernames([rob.id, "gone", sam.id, rob.id])).toEqual(
      new Map([
        [rob.id, "Rob"],
        [sam.id, "sam"],
      ]),
    );
    expect(users.usernames([])).toEqual(new Map());
  });

  it("records a login", async () => {
    const users = await repo();
    const user = users.create({ username: "rob", passwordHash: HASH, now: 1 });

    expect(users.recordLogin(user.id, 5000)).toBe(true);

    expect(users.findById(user.id)).toEqual({ ...user, lastLoginAt: 5000 });
    expect(users.recordLogin("nobody", 5000)).toBe(false);
  });

  it("replaces a password hash", async () => {
    const users = await repo();
    const user = users.create({ username: "rob", passwordHash: HASH, now: 1 });
    const newer = "$scrypt$ln=18,r=8,p=1$c2FsdA$aGFzaA";

    expect(users.updatePasswordHash(user.id, newer, 7000)).toBe(true);

    expect(users.findById(user.id)).toEqual({
      ...user,
      passwordHash: newer,
      updatedAt: 7000,
    });
    expect(users.updatePasswordHash("nobody", newer, 7000)).toBe(false);
  });

  it("checks the role when reading", async () => {
    const db = await testDatabase();
    const users = new UsersRepo(db);
    const user = users.create({ username: "rob", passwordHash: HASH, now: 1 });
    db.$client
      .prepare("UPDATE users SET role = 'superuser' WHERE id = ?")
      .run(user.id);

    expect(() => users.findById(user.id)).toThrow(z.ZodError);
    expect(() => users.findByUsername("rob")).toThrow(z.ZodError);
  });
});
