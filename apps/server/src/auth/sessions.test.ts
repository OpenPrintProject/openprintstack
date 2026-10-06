// SPDX-FileCopyrightText: 2026 Open Print Stack contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { createHash } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import { createRepos } from "../db/repos/index.ts";
import { testDatabase } from "../test-utils.ts";
import {
  SESSION_COOKIE,
  SESSION_TOUCH_INTERVAL_MS,
  SESSION_TTL_MS,
  sessionIdOf,
  SessionService,
} from "./sessions.ts";

const DAY = 24 * 60 * 60_000;
const HOUR = 60 * 60_000;
const START = 1_000_000;

async function setup() {
  const db = await testDatabase();
  const repos = createRepos(db);
  let now = START;
  const service = new SessionService({
    sessions: repos.sessions,
    users: repos.users,
    now: () => now,
  });
  const user = repos.users.create({
    username: "rob",
    passwordHash: "h",
    now: 1,
  });
  const ended: string[] = [];
  service.onSessionEnded((id) => ended.push(id));
  return {
    db,
    repos,
    service,
    user,
    ended,
    at: (time: number) => {
      now = time;
    },
    client: { ip: "127.0.0.1", userAgent: "Safari" },
  };
}

describe("the session settings", () => {
  it("are the plan's: ops_session, 7 days, written at most hourly", () => {
    expect(SESSION_COOKIE).toBe("ops_session");
    expect(SESSION_TTL_MS).toBe(7 * DAY);
    expect(SESSION_TOUCH_INTERVAL_MS).toBe(HOUR);
  });
});

describe("SessionService", () => {
  it("makes a 32-byte base64url token and stores only its sha256", async () => {
    const { repos, service, user, client } = await setup();

    const session = service.create(user.id, client);

    expect(session.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(Buffer.from(session.token, "base64url")).toHaveLength(32);
    const sha256 = createHash("sha256").update(session.token).digest("hex");
    expect(session.sessionId).toBe(sha256);
    expect(sessionIdOf(session.token)).toBe(sha256);
    expect(repos.sessions.findById(sha256)).toEqual({
      id: sha256,
      userId: user.id,
      createdAt: START,
      lastSeenAt: START,
      expiresAt: START + 7 * DAY,
      ip: "127.0.0.1",
      userAgent: "Safari",
    });
  });

  it("never writes the token to the database", async () => {
    const { db, service, user, client } = await setup();

    const { token } = service.create(user.id, client);

    const dump = JSON.stringify(
      db.$client.prepare("SELECT * FROM sessions").all(),
    );
    expect(dump).not.toContain(token);
  });

  it("makes a different token each time", async () => {
    const { service, user, client } = await setup();

    const tokens = new Set(
      Array.from({ length: 20 }, () => service.create(user.id, client).token),
    );

    expect(tokens.size).toBe(20);
  });

  it("cuts a long user agent to 512 characters", async () => {
    const { repos, service, user } = await setup();

    const { sessionId } = service.create(user.id, {
      ip: null,
      userAgent: "x".repeat(600),
    });

    expect(repos.sessions.findById(sessionId)?.userAgent).toBe("x".repeat(512));
  });

  it("finds the session and user for a token", async () => {
    const { service, user, client } = await setup();
    const { token, sessionId } = service.create(user.id, client);

    expect(service.authenticate(token)).toEqual({
      user: { id: user.id, username: "rob" },
      sessionId,
      expiresAt: START + 7 * DAY,
      renewed: false,
    });
  });

  it.each([
    ["no token", undefined],
    ["an empty token", ""],
    ["a token of the wrong length", "abc"],
    ["a token with other characters", `${"a".repeat(42)}=`],
  ])("refuses %s without looking it up", async (_, token) => {
    const { repos, service } = await setup();
    const findById = vi.spyOn(repos.sessions, "findById");

    expect(service.authenticate(token)).toBeUndefined();
    expect(findById).not.toHaveBeenCalled();
  });

  it("refuses a well-formed token that isn't a session", async () => {
    const { service } = await setup();

    expect(service.authenticate("a".repeat(43))).toBeUndefined();
  });

  describe("sliding expiry", () => {
    it("writes nothing for requests within the hour", async () => {
      const { repos, service, user, client, at } = await setup();
      const { token, sessionId } = service.create(user.id, client);
      const touch = vi.spyOn(repos.sessions, "touch");

      at(START + HOUR - 1);
      expect(service.authenticate(token)).toMatchObject({
        renewed: false,
        expiresAt: START + 7 * DAY,
      });

      expect(touch).not.toHaveBeenCalled();
      expect(repos.sessions.findById(sessionId)).toMatchObject({
        lastSeenAt: START,
        expiresAt: START + 7 * DAY,
      });
    });

    it("slides the expiry once the session was written an hour ago", async () => {
      const { repos, service, user, client, at } = await setup();
      const { token, sessionId } = service.create(user.id, client);

      at(START + HOUR);
      expect(service.authenticate(token)).toMatchObject({
        renewed: true,
        expiresAt: START + HOUR + 7 * DAY,
      });

      expect(repos.sessions.findById(sessionId)).toMatchObject({
        lastSeenAt: START + HOUR,
        expiresAt: START + HOUR + 7 * DAY,
      });
      // The next hour counts from the write.
      at(START + 2 * HOUR - 1);
      expect(service.authenticate(token)).toMatchObject({ renewed: false });
    });

    it("keeps a session used every few days alive past its first week", async () => {
      const { service, user, client, at } = await setup();
      const { token } = service.create(user.id, client);

      for (let day = 3; day <= 30; day += 3) {
        at(START + day * DAY);
        expect(service.authenticate(token), `day ${day}`).toBeDefined();
      }
    });
  });

  describe("expiry", () => {
    it("accepts a session until the millisecond it expires", async () => {
      const { service, user, client, at } = await setup();
      const { token } = service.create(user.id, client);

      at(START + 7 * DAY - 1);
      expect(service.authenticate(token)).toBeDefined();
    });

    it("refuses an expired session and deletes it", async () => {
      const { repos, service, user, client, at, ended } = await setup();
      const { token, sessionId } = service.create(user.id, client);

      at(START + 7 * DAY);

      expect(service.authenticate(token)).toBeUndefined();
      expect(repos.sessions.findById(sessionId)).toBeUndefined();
      expect(ended).toEqual([sessionId]);
    });
  });

  it("refuses a disabled user's sessions and deletes all of them", async () => {
    const { db, repos, service, user, client, ended } = await setup();
    const first = service.create(user.id, client);
    const second = service.create(user.id, client);
    const other = repos.users.create({
      username: "sam",
      passwordHash: "h",
      now: 1,
    });
    const others = service.create(other.id, client);
    db.$client
      .prepare("UPDATE users SET disabled_at = 5 WHERE id = ?")
      .run(user.id);

    expect(service.authenticate(first.token)).toBeUndefined();

    expect(repos.sessions.findById(first.sessionId)).toBeUndefined();
    expect(repos.sessions.findById(second.sessionId)).toBeUndefined();
    expect(service.authenticate(others.token)).toBeDefined();
    expect([...ended].sort()).toEqual(
      [first.sessionId, second.sessionId].sort(),
    );
  });

  describe("isActive (for the WebSocket hub)", () => {
    it("is true for a live session and false for an unknown one", async () => {
      const { service, user, client } = await setup();
      const session = service.create(user.id, client);

      expect(service.isActive(session.sessionId)).toBe(true);
      expect(service.isActive(sessionIdOf("x".repeat(43)))).toBe(false);
    });

    it("is false from exactly the expiry, without deleting or telling anyone", async () => {
      const { repos, service, user, client, at, ended } = await setup();
      const session = service.create(user.id, client);

      at(START + SESSION_TTL_MS - 1);
      expect(service.isActive(session.sessionId)).toBe(true);
      at(START + SESSION_TTL_MS);
      expect(service.isActive(session.sessionId)).toBe(false);

      expect(repos.sessions.findById(session.sessionId)).toBeDefined();
      expect(ended).toEqual([]);
    });

    it("never slides the expiry", async () => {
      const { repos, service, user, client, at } = await setup();
      const session = service.create(user.id, client);
      const before = repos.sessions.findById(session.sessionId);

      at(START + 2 * HOUR);
      service.isActive(session.sessionId);

      expect(repos.sessions.findById(session.sessionId)).toEqual(before);
    });

    it("is false for a deleted session, and for a disabled user's", async () => {
      const { db, repos, service, user, client } = await setup();
      const deleted = service.create(user.id, client);
      const disabled = service.create(user.id, client);

      repos.sessions.delete(deleted.sessionId);
      db.$client
        .prepare("UPDATE users SET disabled_at = 5 WHERE id = ?")
        .run(user.id);

      expect(service.isActive(deleted.sessionId)).toBe(false);
      expect(service.isActive(disabled.sessionId)).toBe(false);
      expect(repos.sessions.findById(disabled.sessionId)).toBeDefined();
    });
  });

  describe("end (logout)", () => {
    it("deletes the session and returns it", async () => {
      const { repos, service, user, client, ended } = await setup();
      const { token, sessionId } = service.create(user.id, client);
      const kept = service.create(user.id, client);

      expect(service.end(token)).toMatchObject({
        sessionId,
        user: { id: user.id, username: "rob" },
      });

      expect(repos.sessions.findById(sessionId)).toBeUndefined();
      expect(service.authenticate(token)).toBeUndefined();
      expect(service.authenticate(kept.token)).toBeDefined();
      expect(ended).toEqual([sessionId]);
    });

    it("returns nothing for no session, an unknown one or an expired one", async () => {
      const { repos, service, user, client, at } = await setup();
      const { token, sessionId } = service.create(user.id, client);

      expect(service.end(undefined)).toBeUndefined();
      expect(service.end("a".repeat(43))).toBeUndefined();
      at(START + 7 * DAY);
      expect(service.end(token)).toBeUndefined();
      expect(repos.sessions.findById(sessionId)).toBeUndefined();
    });
  });

  it("stops telling a listener once it unsubscribes", async () => {
    const { service, user, client } = await setup();
    const listener = vi.fn();
    const stop = service.onSessionEnded(listener);
    const first = service.create(user.id, client);
    const second = service.create(user.id, client);

    service.end(first.token);
    stop();
    service.end(second.token);

    expect(listener.mock.calls).toEqual([[first.sessionId]]);
  });
});
