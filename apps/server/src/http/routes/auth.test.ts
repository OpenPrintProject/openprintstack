// SPDX-FileCopyrightText: 2026 Open Print Stack contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it, vi } from "vitest";

import { Passwords } from "../../auth/passwords.ts";
import { sessionIdOf } from "../../auth/sessions.ts";
import {
  apiError,
  PASSWORD,
  sessionCookie,
  START,
  testApp,
  type TestApp,
} from "../test-app.ts";

const HOUR = 60 * 60_000;
const DAY = 24 * HOUR;

async function login(
  t: TestApp,
  username: string,
  password: string,
  ip = "10.0.0.1",
) {
  return t.call("POST", "/api/auth/login", {
    json: { username, password },
    ip,
  });
}

/** The Set-Cookie header for ops_session, or undefined. */
function setCookie(response: Response): string | undefined {
  return response.headers
    .getSetCookie()
    .find((header) => header.startsWith("ops_session="));
}

describe("the auth flow", () => {
  it("goes setup → me → logout → login → me", async () => {
    const t = await testApp();

    const before = await t.call("GET", "/api/auth/me");
    expect(before.status).toBe(401);
    expect((await apiError(before)).code).toBe("setup_required");

    const setup = await t.call("POST", "/api/auth/setup", {
      json: { username: "rob", password: PASSWORD },
    });
    expect(setup.status).toBe(201);
    const { user } = (await setup.json()) as {
      user: { id: string; username: string };
    };
    expect(user.username).toBe("rob");
    const first = sessionCookie(setup);
    expect(first).toMatch(/^[A-Za-z0-9_-]{43}$/);

    const me = await t.call("GET", "/api/auth/me", { token: first });
    expect(me.status).toBe(200);
    expect(await me.json()).toEqual({ user });

    const logout = await t.call("POST", "/api/auth/logout", { token: first });
    expect(logout.status).toBe(204);
    expect(setCookie(logout)).toContain("Max-Age=0");
    const after = await t.call("GET", "/api/auth/me", { token: first });
    expect(after.status).toBe(401);
    expect((await apiError(after)).code).toBe("unauthenticated");

    const loggedIn = await login(t, "rob", PASSWORD);
    expect(loggedIn.status).toBe(200);
    expect(await loggedIn.json()).toEqual({ user });
    const second = sessionCookie(loggedIn);
    expect(second).toBeDefined();
    expect(second).not.toBe(first);
    expect(
      (await t.call("GET", "/api/auth/me", { token: second })).status,
    ).toBe(200);

    expect(
      t.events.map(({ type, source, printerId, payload }) => ({
        type,
        source,
        printerId,
        payload,
      })),
    ).toEqual([
      {
        type: "auth.setup_completed",
        source: { kind: "user", userId: user.id },
        printerId: null,
        payload: {},
      },
      {
        type: "auth.logout",
        source: { kind: "user", userId: user.id },
        printerId: null,
        payload: {},
      },
      {
        type: "auth.login_succeeded",
        source: { kind: "user", userId: user.id },
        printerId: null,
        payload: {},
      },
    ]);
  });

  it("sets the cookie HttpOnly, SameSite=Lax, Path=/, for 7 days, and not Secure", async () => {
    const t = await testApp();

    const setup = await t.call("POST", "/api/auth/setup", {
      json: { username: "rob", password: PASSWORD },
    });

    const cookie = setCookie(setup) ?? "";
    const [pair, ...attributes] = cookie.split("; ");
    expect(pair).toMatch(/^ops_session=[A-Za-z0-9_-]{43}$/);
    expect(attributes.sort()).toEqual(
      ["HttpOnly", "Max-Age=604800", "Path=/", "SameSite=Lax"].sort(),
    );
  });
});

describe("POST /api/auth/setup", () => {
  it("answers 409 setup_done once a user exists, and changes nothing", async () => {
    const t = await testApp();
    await t.setupAdmin("rob");

    const again = await t.call("POST", "/api/auth/setup", {
      json: { username: "sam", password: PASSWORD },
    });

    expect(again.status).toBe(409);
    expect(await apiError(again)).toEqual({
      code: "setup_done",
      message: "Setup has already been done.",
    });
    expect(sessionCookie(again)).toBeUndefined();
    expect(t.repos.users.count()).toBe(1);
    expect(t.types("auth.setup_completed")).toHaveLength(1);
  });

  it("refuses a second setup before hashing its password", async () => {
    const t = await testApp();
    await t.setupAdmin("rob");
    const hash = vi.spyOn(t.deps.passwords, "hash");

    const again = await t.call("POST", "/api/auth/setup", {
      json: { username: "sam", password: PASSWORD },
    });

    expect(again.status).toBe(409);
    expect(hash).not.toHaveBeenCalled();
  });

  it("lets exactly one of two setups sent at once win", async () => {
    const t = await testApp();
    // Hold both hashes until both setups are past the first check.
    const hash = t.deps.passwords.hash.bind(t.deps.passwords);
    let waiting = 0;
    let release!: () => void;
    const bothHashing = new Promise<void>((resolve) => {
      release = resolve;
    });
    vi.spyOn(t.deps.passwords, "hash").mockImplementation(async (password) => {
      if (++waiting === 2) release();
      await bothHashing;
      return hash(password);
    });

    const answers = await Promise.all(
      ["rob", "sam"].map((username) =>
        t.call("POST", "/api/auth/setup", {
          json: { username, password: PASSWORD },
        }),
      ),
    );

    expect(answers.map((answer) => answer.status).sort()).toEqual([201, 409]);
    expect(t.repos.users.count()).toBe(1);
    expect(t.types("auth.setup_completed")).toHaveLength(1);
  });

  describe("password length", () => {
    it("refuses an 11-character password", async () => {
      const t = await testApp();

      const answer = await t.call("POST", "/api/auth/setup", {
        json: { username: "rob", password: "a".repeat(11) },
      });

      expect(answer.status).toBe(400);
      const error = await apiError(answer);
      expect(error.code).toBe("validation_failed");
      expect(error.message).toContain("Must be at least 12 characters.");
      expect(error.details).toMatchObject([{ path: ["password"] }]);
      expect(t.repos.users.count()).toBe(0);
    });

    it("accepts a 12-character password", async () => {
      const t = await testApp();

      const answer = await t.call("POST", "/api/auth/setup", {
        json: { username: "rob", password: "a".repeat(12) },
      });

      expect(answer.status).toBe(201);
    });

    it.each([
      ["12 emoji (24 UTF-16 units)", "😀".repeat(12), 201],
      ["11 emoji (22 UTF-16 units)", "😀".repeat(11), 400],
      ["6 decomposed é (12 UTF-16 units, 6 after NFKC)", "é".repeat(6), 400],
      ["12 spaces, not trimmed", " ".repeat(12), 201],
      ["1024 characters", "a".repeat(1024), 201],
      ["1025 characters", "a".repeat(1025), 400],
    ])("counts code points after NFKC: %s", async (_, password, status) => {
      const t = await testApp();

      const answer = await t.call("POST", "/api/auth/setup", {
        json: { username: "rob", password },
      });

      expect(answer.status).toBe(status);
    });

    it("never echoes the password in a validation error", async () => {
      const t = await testApp();

      const answer = await t.call("POST", "/api/auth/setup", {
        json: { username: "rob", password: "hunter2 secr".slice(0, 11) },
      });

      expect(answer.status).toBe(400);
      expect(await answer.text()).not.toContain("hunter2");
    });
  });

  describe("usernames", () => {
    it.each(["rob", "Rob.Smith_2-x", "a", "x".repeat(32)])(
      "accepts %j",
      async (username) => {
        const t = await testApp();
        await t.setupAdmin(username);
        expect(t.repos.users.findByUsername(username)?.username).toBe(username);
      },
    );

    it("trims the username", async () => {
      const t = await testApp();

      const { user } = await t.setupAdmin("  rob  ");

      expect(user.username).toBe("rob");
    });

    it.each(["", "   ", "a b", "émile", "rob@home", "x".repeat(33), "ro/b"])(
      "refuses %j",
      async (username) => {
        const t = await testApp();

        const answer = await t.call("POST", "/api/auth/setup", {
          json: { username, password: PASSWORD },
        });

        expect(answer.status).toBe(400);
        expect(await apiError(answer)).toMatchObject({
          code: "validation_failed",
          details: [{ path: ["username"] }],
        });
      },
    );
  });

  it("stores the client's address and user agent with the session", async () => {
    const t = await testApp();

    const answer = await t.call("POST", "/api/auth/setup", {
      json: { username: "rob", password: PASSWORD },
      ip: "192.168.1.20",
      headers: { "user-agent": "Safari" },
    });

    const session = t.repos.sessions.findById(
      sessionIdOf(sessionCookie(answer) ?? ""),
    );
    expect(session).toMatchObject({ ip: "192.168.1.20", userAgent: "Safari" });
  });
});

describe("POST /api/auth/login", () => {
  it("ignores the username's case", async () => {
    const t = await testApp();
    await t.setupAdmin("Rob");

    expect((await login(t, "rOB", PASSWORD)).status).toBe(200);
  });

  it("records the login time", async () => {
    const t = await testApp();
    const { user } = await t.setupAdmin();
    t.at(START + 5000);

    await login(t, "rob", PASSWORD);

    expect(t.repos.users.findById(user.id)?.lastLoginAt).toBe(START + 5000);
  });

  it.each([
    ["a wrong password", "rob", "wrong password"],
    ["an unknown user", "sam", PASSWORD],
  ])("answers %s with the same 401", async (_, username, password) => {
    const t = await testApp();
    await t.setupAdmin();

    const answer = await login(t, username, password);

    expect(answer.status).toBe(401);
    expect(await apiError(answer)).toEqual({
      code: "invalid_credentials",
      message: "The username or password is wrong.",
    });
    expect(sessionCookie(answer)).toBeUndefined();
  });

  it("checks a password even for an unknown user, so timing doesn't tell", async () => {
    const t = await testApp();
    await t.setupAdmin();
    const nobody = vi.spyOn(t.deps.passwords, "verifyNobody");

    await login(t, "sam", PASSWORD);

    expect(nobody).toHaveBeenCalledWith(PASSWORD);
  });

  it("publishes login_failed from the system with the username, cut to 64 characters", async () => {
    const t = await testApp();
    await t.setupAdmin();

    await login(t, "x".repeat(100), PASSWORD);

    const failed = t.events.filter(
      (event) => event.type === "auth.login_failed",
    );
    expect(failed).toMatchObject([
      {
        source: { kind: "system" },
        printerId: null,
        payload: { username: "x".repeat(64) },
      },
    ]);
  });

  it("cuts the logged username by code points, never splitting one", async () => {
    const t = await testApp();
    await t.setupAdmin();

    await login(t, `${"x".repeat(63)}😀😀`, PASSWORD);

    expect(
      t.events.find((event) => event.type === "auth.login_failed")?.payload,
    ).toEqual({ username: `${"x".repeat(63)}😀` });
  });

  it("refuses a disabled user even with the right password", async () => {
    const t = await testApp();
    const { user } = await t.setupAdmin();
    t.db.$client
      .prepare("UPDATE users SET disabled_at = 1 WHERE id = ?")
      .run(user.id);

    const answer = await login(t, "rob", PASSWORD);

    expect(answer.status).toBe(401);
    expect((await apiError(answer)).code).toBe("invalid_credentials");
    expect(t.types("auth.login_failed")).toHaveLength(1);
  });

  it("rehashes a password hashed with older settings, once", async () => {
    const t = await testApp();
    const old = await new Passwords({ ln: 5, r: 8, p: 1 }).hash(PASSWORD);
    const user = t.repos.users.create({
      username: "rob",
      passwordHash: old,
      now: 1,
    });
    const update = vi.spyOn(t.repos.users, "updatePasswordHash");

    expect((await login(t, "rob", "wrong password")).status).toBe(401);
    expect(update).not.toHaveBeenCalled();
    expect((await login(t, "rob", PASSWORD)).status).toBe(200);
    expect((await login(t, "rob", PASSWORD)).status).toBe(200);

    expect(update).toHaveBeenCalledTimes(1);
    const stored = t.repos.users.findById(user.id)?.passwordHash ?? "";
    expect(stored).toMatch(/^\$scrypt\$ln=4,r=8,p=1\$/);
    await expect(t.deps.passwords.verify(PASSWORD, stored)).resolves.toEqual({
      ok: true,
      rehash: false,
    });
  });

  it("refuses an invalid body with 400, counting nothing", async () => {
    const t = await testApp();
    await t.setupAdmin();

    for (let i = 0; i < 10; i++) {
      const answer = await t.call("POST", "/api/auth/login", {
        json: { username: "rob" },
        ip: "10.0.0.1",
      });
      expect(answer.status).toBe(400);
    }

    expect(t.types("auth.login_failed")).toEqual([]);
    expect((await login(t, "rob", PASSWORD)).status).toBe(200);
  });

  describe("backoff", () => {
    it("lets 5 failures through, then makes the address wait 1 s, doubling", async () => {
      const t = await testApp();
      await t.setupAdmin();
      const verify = vi.spyOn(t.deps.passwords, "verify");

      for (let i = 1; i <= 6; i++) {
        expect((await login(t, "rob", "wrong password")).status, `#${i}`).toBe(
          401,
        );
      }
      verify.mockClear();

      const refused = await login(t, "rob", PASSWORD);
      expect(refused.status).toBe(429);
      expect(refused.headers.get("retry-after")).toBe("1");
      expect(await apiError(refused)).toEqual({
        code: "too_many_attempts",
        message: "Too many failed logins. Try again in 1 s.",
      });
      // Refused without checking the password, and without an event.
      expect(verify).not.toHaveBeenCalled();
      expect(t.types("auth.login_failed")).toHaveLength(6);

      t.advance(1000);
      expect((await login(t, "rob", "wrong password")).status).toBe(401);
      const longer = await login(t, "rob", PASSWORD);
      expect(longer.status).toBe(429);
      expect(longer.headers.get("retry-after")).toBe("2");
    });

    it("doesn't extend the wait for refused attempts", async () => {
      const t = await testApp();
      await t.setupAdmin();
      for (let i = 0; i < 6; i++) await login(t, "rob", "wrong password");

      for (let i = 0; i < 5; i++) {
        expect((await login(t, "rob", "wrong password")).status).toBe(429);
        t.advance(100);
      }

      t.advance(500);
      expect((await login(t, "rob", PASSWORD)).status).toBe(200);
    });

    it("keeps addresses apart", async () => {
      const t = await testApp();
      await t.setupAdmin();
      for (let i = 0; i < 6; i++) {
        await login(t, "rob", "wrong password", "10.0.0.1");
      }

      expect((await login(t, "rob", PASSWORD, "10.0.0.1")).status).toBe(429);
      expect((await login(t, "rob", PASSWORD, "10.0.0.2")).status).toBe(200);
    });

    it("clears an address's failures when it logs in", async () => {
      const t = await testApp();
      await t.setupAdmin();
      for (let i = 0; i < 5; i++) await login(t, "rob", "wrong password");

      expect((await login(t, "rob", PASSWORD)).status).toBe(200);
      for (let i = 0; i < 5; i++) {
        expect((await login(t, "rob", "wrong password")).status).toBe(401);
      }
    });
  });
});

describe("sessions over HTTP", () => {
  it("sends the cookie again only when the expiry slides, hourly", async () => {
    const t = await testApp();
    const { token } = await t.setupAdmin();

    t.at(START + HOUR - 1);
    const early = await t.call("GET", "/api/auth/me", { token });
    expect(early.status).toBe(200);
    expect(setCookie(early)).toBeUndefined();

    t.at(START + HOUR);
    const slid = await t.call("GET", "/api/auth/me", { token });
    expect(slid.status).toBe(200);
    expect(sessionCookie(slid)).toBe(token);
    expect(setCookie(slid)).toContain("Max-Age=604800");
    expect(t.repos.sessions.findById(sessionIdOf(token))?.expiresAt).toBe(
      START + HOUR + 7 * DAY,
    );
  });

  it("refuses an expired session, and clears its cookie", async () => {
    const t = await testApp();
    const { token } = await t.setupAdmin();

    t.at(START + 7 * DAY);
    const answer = await t.call("GET", "/api/auth/me", { token });

    expect(answer.status).toBe(401);
    expect((await apiError(answer)).code).toBe("unauthenticated");
    expect(setCookie(answer)).toContain("Max-Age=0");
    expect(t.repos.sessions.findById(sessionIdOf(token))).toBeUndefined();
  });

  it("stays logged in when used every few days", async () => {
    const t = await testApp();
    const { token } = await t.setupAdmin();

    for (let day = 5; day <= 40; day += 5) {
      t.at(START + day * DAY);
      expect(
        (await t.call("GET", "/api/auth/me", { token })).status,
        `day ${day}`,
      ).toBe(200);
    }
  });

  it("answers a garbage cookie with 401 and clears it", async () => {
    const t = await testApp();
    await t.setupAdmin();

    const answer = await t.call("GET", "/api/auth/me", { token: "nope" });

    expect(answer.status).toBe(401);
    expect(setCookie(answer)).toContain("Max-Age=0");
  });

  it("doesn't clear anything when there's no cookie", async () => {
    const t = await testApp();
    await t.setupAdmin();

    const answer = await t.call("GET", "/api/auth/me");

    expect(answer.status).toBe(401);
    expect(setCookie(answer)).toBeUndefined();
  });
});

describe("POST /api/auth/logout", () => {
  it("ends only this session", async () => {
    const t = await testApp();
    const { token } = await t.setupAdmin();
    const other = sessionCookie(await login(t, "rob", PASSWORD)) ?? "";

    await t.call("POST", "/api/auth/logout", { token });

    expect((await t.call("GET", "/api/auth/me", { token })).status).toBe(401);
    expect((await t.call("GET", "/api/auth/me", { token: other })).status).toBe(
      200,
    );
  });

  it("answers 204 without a session, publishing nothing", async () => {
    const t = await testApp();
    const { token } = await t.setupAdmin();
    await t.call("POST", "/api/auth/logout", { token });
    t.events.length = 0;

    const again = await t.call("POST", "/api/auth/logout", { token });
    const none = await t.call("POST", "/api/auth/logout");

    expect(again.status).toBe(204);
    expect(none.status).toBe(204);
    expect(setCookie(none)).toContain("Max-Age=0");
    expect(t.events).toEqual([]);
  });

  it("can't be triggered by another site", async () => {
    const t = await testApp();
    const { token } = await t.setupAdmin();

    const answer = await t.call("POST", "/api/auth/logout", {
      token,
      origin: "http://evil.example",
    });

    expect(answer.status).toBe(403);
    expect((await t.call("GET", "/api/auth/me", { token })).status).toBe(200);
  });

  it("tells the session's listeners, for PR 9's WebSocket hub", async () => {
    const t = await testApp();
    const { token } = await t.setupAdmin();
    const ended = vi.fn();
    t.deps.sessions.onSessionEnded(ended);

    await t.call("POST", "/api/auth/logout", { token });

    expect(ended).toHaveBeenCalledWith(sessionIdOf(token));
  });
});
