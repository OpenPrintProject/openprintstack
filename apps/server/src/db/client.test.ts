// SPDX-FileCopyrightText: 2026 Open Print Stack contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { access } from "node:fs/promises";
import path from "node:path";

import { eventFixtures, USER_ID } from "@openprintstack/protocol/fixtures";
import Database from "better-sqlite3";
import { eq } from "drizzle-orm";
import { describe, expect, it, onTestFinished } from "vitest";

import { tempDir, testDatabase } from "../test-utils.ts";
import { configureConnection, openDatabase } from "./client.ts";
import { createRepos } from "./repos/index.ts";
import { events, sessions, users } from "./schema.ts";

function settings(sqlite: Database.Database): Record<string, unknown> {
  return Object.fromEntries(
    ["journal_mode", "synchronous", "foreign_keys", "busy_timeout"].map(
      (name) => [name, sqlite.pragma(name, { simple: true })],
    ),
  );
}

const PLAN_SETTINGS = {
  journal_mode: "wal",
  synchronous: 1, // NORMAL
  foreign_keys: 1,
  busy_timeout: 5000,
};

describe("configureConnection", () => {
  // better-sqlite3 13 already defaults to all of these but WAL, so start
  // from the opposite of each to see that every one is really set.
  it("applies each of the plan's settings", async () => {
    const sqlite = new Database(path.join(await tempDir(), "ops.sqlite"), {
      timeout: 0,
    });
    onTestFinished(() => {
      sqlite.close();
    });
    sqlite.pragma("journal_mode = DELETE");
    sqlite.pragma("synchronous = FULL");
    sqlite.pragma("foreign_keys = OFF");
    expect(settings(sqlite)).toEqual({
      journal_mode: "delete",
      synchronous: 2,
      foreign_keys: 0,
      busy_timeout: 0,
    });

    configureConnection(sqlite);

    expect(settings(sqlite)).toEqual(PLAN_SETTINGS);
  });
});

describe("openDatabase", () => {
  it("applies the plan's connection settings", async () => {
    const db = await testDatabase();

    expect(settings(db.$client)).toEqual(PLAN_SETTINGS);
  });

  it("creates the file, which then has a write-ahead log", async () => {
    const file = path.join(await tempDir(), "ops.sqlite");
    const db = openDatabase(file);
    try {
      db.$client.exec("CREATE TABLE t (x INTEGER)");
      await access(file);
      await access(`${file}-wal`);
    } finally {
      db.$client.close();
    }
  });

  it("refuses a database that can't use WAL", () => {
    // An in-memory database always reports journal_mode=memory.
    expect(() => openDatabase(":memory:")).toThrow(
      "Couldn't switch :memory: to WAL mode (it's in memory mode).",
    );
  });
});

describe("foreign keys", () => {
  it("refuses a session for a user that doesn't exist", async () => {
    const { sessions: repo } = createRepos(await testDatabase());

    expect(() =>
      repo.create({
        id: "s1",
        userId: "nobody",
        now: 1,
        expiresAt: 2,
        ip: null,
        userAgent: null,
      }),
    ).toThrow(
      expect.objectContaining({ code: "SQLITE_CONSTRAINT_FOREIGNKEY" }),
    );
  });

  it("deletes a user's sessions with the user", async () => {
    const db = await testDatabase();
    const repos = createRepos(db);
    const rob = repos.users.create({
      username: "rob",
      passwordHash: "h",
      now: 1,
    });
    const ann = repos.users.create({
      username: "ann",
      passwordHash: "h",
      now: 1,
    });
    for (const [id, userId] of [
      ["s1", rob.id],
      ["s2", rob.id],
      ["s3", ann.id],
    ] as const) {
      repos.sessions.create({
        id,
        userId,
        now: 1,
        expiresAt: 2,
        ip: null,
        userAgent: null,
      });
    }

    db.delete(users).where(eq(users.id, rob.id)).run();

    expect(db.select({ id: sessions.id }).from(sessions).all()).toEqual([
      { id: "s3" },
    ]);
  });

  it("events have none, so history outlives printers and users", async () => {
    const db = await testDatabase();
    const { events: repo } = createRepos(db);

    // Neither the printer nor the user exists.
    repo.insertMany([eventFixtures["command.requested"]]);

    expect(db.$client.pragma("foreign_key_list(events)")).toEqual([]);
    expect(
      db
        .select({ printerId: events.printerId, userId: events.userId })
        .from(events)
        .all(),
    ).toEqual([
      {
        printerId: eventFixtures["command.requested"].printerId,
        userId: USER_ID,
      },
    ]);
  });
});
