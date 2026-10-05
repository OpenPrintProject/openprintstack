// SPDX-FileCopyrightText: 2026 Open Print Stack contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from "vitest";

import { testDatabase } from "../../test-utils.ts";
import { createRepos, type Repos } from "./index.ts";

const SESSION_ID =
  "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08";

async function setup(): Promise<{ repos: Repos; userId: string }> {
  const repos = createRepos(await testDatabase());
  const user = repos.users.create({
    username: "rob",
    passwordHash: "h",
    now: 1,
  });
  return { repos, userId: user.id };
}

describe("SessionsRepo", () => {
  it("creates a session, last seen when it's created", async () => {
    const { repos, userId } = await setup();

    const session = repos.sessions.create({
      id: SESSION_ID,
      userId,
      now: 1000,
      expiresAt: 1000 + 7 * 24 * 3600 * 1000,
      ip: "127.0.0.1",
      userAgent: "Safari",
    });

    expect(session).toEqual({
      id: SESSION_ID,
      userId,
      createdAt: 1000,
      lastSeenAt: 1000,
      expiresAt: 604_801_000,
      ip: "127.0.0.1",
      userAgent: "Safari",
    });
    expect(repos.sessions.findById(SESSION_ID)).toEqual(session);
  });

  it("allows an unknown ip and user agent", async () => {
    const { repos, userId } = await setup();

    repos.sessions.create({
      id: SESSION_ID,
      userId,
      now: 1,
      expiresAt: 2,
      ip: null,
      userAgent: null,
    });

    expect(repos.sessions.findById(SESSION_ID)).toMatchObject({
      ip: null,
      userAgent: null,
    });
  });

  it("finds nothing for an unknown id", async () => {
    const { repos } = await setup();

    expect(repos.sessions.findById(SESSION_ID)).toBeUndefined();
  });

  it("refuses a duplicate id", async () => {
    const { repos, userId } = await setup();
    const input = {
      id: SESSION_ID,
      userId,
      now: 1,
      expiresAt: 2,
      ip: null,
      userAgent: null,
    };
    repos.sessions.create(input);

    expect(() => repos.sessions.create(input)).toThrow(
      expect.objectContaining({ code: "SQLITE_CONSTRAINT_PRIMARYKEY" }),
    );
  });

  it("deletes sessions that have expired by now, and returns how many", async () => {
    const { repos, userId } = await setup();
    const add = (id: string, expiresAt: number) =>
      repos.sessions.create({
        id,
        userId,
        now: 0,
        expiresAt,
        ip: null,
        userAgent: null,
      });
    add("a", 999);
    add("b", 1000);
    add("c", 1001);

    expect(repos.sessions.deleteExpired(1000)).toBe(2);

    expect(repos.sessions.findById("a")).toBeUndefined();
    expect(repos.sessions.findById("b")).toBeUndefined();
    expect(repos.sessions.findById("c")).toBeDefined();
    expect(repos.sessions.deleteExpired(1000)).toBe(0);
  });
});
