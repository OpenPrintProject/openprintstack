// SPDX-FileCopyrightText: 2026 Open Print Stack contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it, vi } from "vitest";

import { jsonLines } from "../test-utils.ts";
import { ERROR_STATUS } from "./errors.ts";
import { allowedHostNames } from "./middleware/host.ts";
import { apiError, PASSWORD, testApp } from "./test-app.ts";

describe("the Host check", () => {
  it.each([
    "localhost",
    "127.0.0.1",
    "[::1]",
    "localhost:5173",
    "127.0.0.1:7337",
  ])("answers %s", async (host) => {
    const t = await testApp();
    const answer = await t.call("GET", "/api/auth/me", { host });
    expect(answer.status).toBe(401);
  });

  it.each(["evil.example", "evil.example:7337", "127.0.0.1.nip.io", "0.0.0.0"])(
    "refuses %s with 403, before anything else",
    async (host) => {
      const t = await testApp();

      const answer = await t.call("POST", "/api/auth/setup", {
        host,
        json: { username: "rob", password: PASSWORD },
      });

      expect(answer.status).toBe(403);
      expect(await apiError(answer)).toMatchObject({
        code: "host_not_allowed",
      });
      expect(t.repos.users.count()).toBe(0);
    },
  );

  it("answers OPS_HOST and OPS_ALLOWED_HOSTS too", async () => {
    const t = await testApp({
      config: { host: "printers.local", allowedHosts: ["192.168.1.20"] },
    });

    for (const host of ["printers.local", "192.168.1.20:7337", "localhost"]) {
      expect((await t.call("GET", "/api/auth/me", { host })).status, host).toBe(
        401,
      );
    }
    expect(
      (await t.call("GET", "/api/auth/me", { host: "other.local" })).status,
    ).toBe(403);
  });

  it("lists loopback, OPS_HOST unless it's a wildcard, and OPS_ALLOWED_HOSTS", () => {
    expect([
      ...allowedHostNames({ host: "::1", allowedHosts: ["a.local"] }),
    ]).toEqual(["localhost", "127.0.0.1", "[::1]", "a.local"]);
    expect([
      ...allowedHostNames({ host: "0.0.0.0", allowedHosts: [] }),
    ]).toEqual(["localhost", "127.0.0.1", "[::1]"]);
    expect([...allowedHostNames({ host: "::", allowedHosts: [] })]).toEqual([
      "localhost",
      "127.0.0.1",
      "[::1]",
    ]);
    expect([
      ...allowedHostNames({ host: "Printers.Local", allowedHosts: [] }),
    ]).toContain("printers.local");
  });
});

describe("the Origin check", () => {
  it("refuses a cross-origin POST with 403, before it does anything", async () => {
    const t = await testApp();

    const answer = await t.call("POST", "/api/auth/setup", {
      json: { username: "rob", password: PASSWORD },
      origin: "http://evil.example",
    });

    expect(answer.status).toBe(403);
    expect(await apiError(answer)).toEqual({
      code: "origin_not_allowed",
      message: "Requests from other sites aren't allowed.",
    });
    expect(t.repos.users.count()).toBe(0);
  });

  it.each(["PUT", "PATCH", "DELETE"])(
    "refuses a cross-origin %s",
    async (method) => {
      const t = await testApp();
      const { token } = await t.setupAdmin();
      const id = await t.addPrinter(token);

      const answer = await t.call(method, `/api/printers/${id}`, {
        token,
        origin: "http://localhost:8080",
        json: { name: "Renamed" },
      });

      expect(answer.status).toBe(403);
      expect(t.store.get(id)?.printer.name).toBe("Bench");
    },
  );

  it.each([
    ["another port", "http://localhost:5173"],
    ["https", "https://localhost"],
    ["null", "null"],
    ["a look-alike", "http://localhost.evil.example"],
  ])("refuses an Origin on %s", async (_, origin) => {
    const t = await testApp();

    const answer = await t.call("POST", "/api/auth/setup", {
      json: { username: "rob", password: PASSWORD },
      origin,
    });

    expect(answer.status).toBe(403);
  });

  it("allows the page's own origin, through Vite's proxy too", async () => {
    const t = await testApp();

    // Vite keeps the browser's Host, so both say localhost:5173.
    const answer = await t.call("POST", "/api/auth/setup", {
      json: { username: "rob", password: PASSWORD },
      host: "localhost:5173",
      origin: "http://localhost:5173",
    });

    expect(answer.status).toBe(201);
  });

  it("allows a request with no Origin, which no browser page sends", async () => {
    const t = await testApp();

    const answer = await t.call("POST", "/api/auth/setup", {
      json: { username: "rob", password: PASSWORD },
      origin: null,
    });

    expect(answer.status).toBe(201);
  });

  it("doesn't check safe methods", async () => {
    const t = await testApp();
    const { token } = await t.setupAdmin();

    const answer = await t.call("GET", "/api/auth/me", {
      token,
      origin: "http://evil.example",
    });

    expect(answer.status).toBe(200);
  });
});

describe("security headers", () => {
  it.each([
    ["a success", "GET", "/api/auth/me", 200],
    ["a 401", "GET", "/api/auth/me", 401],
    ["a 404", "GET", "/api/nothing", 404],
    ["a 403", "POST", "/api/auth/logout", 403],
  ] as const)("are on %s", async (_, method, path, status) => {
    const t = await testApp();
    const { token } = await t.setupAdmin();

    const answer = await t.call(method, path, {
      ...(status === 200 && { token }),
      ...(status === 403 && { origin: "http://evil.example" }),
    });

    expect(answer.status).toBe(status);
    const headers = Object.fromEntries(answer.headers);
    expect(headers).toMatchObject({
      "content-security-policy": "default-src 'none'; frame-ancestors 'none'",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      "x-frame-options": "SAMEORIGIN",
      "referrer-policy": "same-origin",
      "cross-origin-opener-policy": "same-origin",
      "cross-origin-resource-policy": "same-origin",
    });
    expect(headers["strict-transport-security"]).toBeUndefined();
  });

  it("aren't on /api/ws, which PR 9 upgrades", async () => {
    const t = await testApp();

    const answer = await t.call("GET", "/api/ws");

    expect(answer.headers.get("content-security-policy")).toBeNull();
    expect(answer.headers.get("x-frame-options")).toBeNull();
  });

  it("leave out the API's CSP and no-store outside /api", async () => {
    const t = await testApp();

    const answer = await t.call("GET", "/elsewhere");

    expect(answer.headers.get("x-content-type-options")).toBe("nosniff");
    expect(answer.headers.get("content-security-policy")).toBeNull();
    expect(answer.headers.get("cache-control")).toBeNull();
  });
});

describe("the body limit", () => {
  it("refuses JSON over 64 KiB with 413, before parsing it", async () => {
    const t = await testApp();

    const answer = await t.call("POST", "/api/auth/login", {
      json: { username: "rob", password: "x".repeat(64 * 1024) },
      headers: { "content-length": String(64 * 1024 + 40) },
    });

    expect(answer.status).toBe(413);
    expect(await apiError(answer)).toEqual({
      code: "payload_too_large",
      message: "The body is over the 64 KiB limit.",
    });
  });

  it("counts a body without a Content-Length as it arrives", async () => {
    const t = await testApp();
    const big = new TextEncoder().encode(
      JSON.stringify({ username: "rob", password: "x".repeat(70_000) }),
    );

    const answer = await t.call("POST", "/api/auth/login", {
      body: new ReadableStream({
        start(controller) {
          controller.enqueue(big);
          controller.close();
        },
      }),
      headers: { "content-type": "application/json" },
    });

    expect(answer.status).toBe(413);
  });

  it("allows exactly 64 KiB", async () => {
    const t = await testApp();
    const json = { username: "rob", password: "" };
    const overhead = JSON.stringify(json).length;
    json.password = "x".repeat(64 * 1024 - overhead);

    const answer = await t.call("POST", "/api/auth/login", { json });

    expect(answer.status).toBe(401);
  });
});

describe("errors", () => {
  it("answers a failed schema with 400 validation_failed and Zod's issues", async () => {
    const t = await testApp();

    const answer = await t.call("POST", "/api/auth/setup", {
      json: { username: 5 },
    });

    expect(answer.status).toBe(400);
    const error = await apiError(answer);
    expect(error.code).toBe("validation_failed");
    expect(error.message).toMatch(/^The request body isn't valid\. ✖/);
    expect(error.details).toEqual([
      expect.objectContaining({ path: ["username"], code: "invalid_type" }),
      expect.objectContaining({ path: ["password"], code: "invalid_type" }),
    ]);
  });

  it("names the part that failed", async () => {
    const t = await testApp();
    const { token } = await t.setupAdmin();

    const answer = await t.call("GET", "/api/events?limit=0", { token });

    expect(answer.status).toBe(400);
    expect((await apiError(answer)).message).toMatch(
      /^The request query isn't valid\./,
    );
  });

  it("answers malformed JSON with 400 invalid_json", async () => {
    const t = await testApp();

    const answer = await t.call("POST", "/api/auth/login", {
      body: "{ nope",
      headers: { "content-type": "application/json" },
    });

    expect(answer.status).toBe(400);
    expect(await apiError(answer)).toEqual({
      code: "invalid_json",
      message: "The body isn't valid JSON.",
    });
  });

  it("answers a body that isn't JSON with 415", async () => {
    const t = await testApp();

    const answer = await t.call("POST", "/api/auth/login", {
      body: "username=rob",
      headers: { "content-type": "application/x-www-form-urlencoded" },
    });

    expect(answer.status).toBe(415);
    expect((await apiError(answer)).code).toBe("unsupported_media_type");
  });

  it("answers an unknown path, or a known one with another method, with 404", async () => {
    const t = await testApp();

    for (const [method, path] of [
      ["GET", "/api/nothing"],
      ["DELETE", "/api/auth/me"],
      ["GET", "/"],
    ] as const) {
      const answer = await t.call(method, path);
      expect(answer.status, `${method} ${path}`).toBe(404);
      expect(await apiError(answer)).toEqual({
        code: "not_found",
        message: `There's nothing at ${method} ${path}.`,
      });
    }
  });

  it("answers an unexpected error with 500 internal, logging it but telling the client nothing", async () => {
    const t = await testApp();
    const { token } = await t.setupAdmin();
    vi.spyOn(t.repos.printers, "list").mockImplementation(() => {
      throw new Error("disk on fire at /secret/path");
    });

    const answer = await t.call("GET", "/api/printers", { token });

    expect(answer.status).toBe(500);
    expect(await apiError(answer)).toEqual({
      code: "internal",
      message: "Something went wrong on the server.",
    });
    expect(jsonLines(t.logs)).toContainEqual(
      expect.objectContaining({
        level: "error",
        component: "http",
        msg: "A request failed unexpectedly",
        method: "GET",
        path: "/api/printers",
        err: expect.objectContaining({
          message: "disk on fire at /secret/path",
        }) as unknown,
      }),
    );
  });

  it("gives every error code a status", () => {
    // Written out, so a missing or changed status fails here.
    expect(ERROR_STATUS).toEqual({
      printer_busy: 409,
      unsupported: 422,
      printer_offline: 409,
      invalid_state: 409,
      unsafe: 422,
      file_too_large: 413,
      timeout: 504,
      file_not_found: 404,
      printer_rejected: 422,
      internal: 500,
      printer_not_found: 404,
      name_taken: 409,
      unknown_driver_type: 422,
      invalid_settings: 422,
      job_active: 409,
      validation_failed: 400,
      invalid_json: 400,
      upload_incomplete: 400,
      unauthenticated: 401,
      setup_required: 401,
      invalid_credentials: 401,
      host_not_allowed: 403,
      origin_not_allowed: 403,
      not_found: 404,
      setup_done: 409,
      length_required: 411,
      payload_too_large: 413,
      unsupported_media_type: 415,
      too_many_attempts: 429,
    });
  });
});

describe("the request log", () => {
  it("writes one debug line per request, without the query or cookies", async () => {
    const t = await testApp();
    const { token, user } = await t.setupAdmin();
    t.logs.lines.length = 0;

    await t.call("GET", "/api/events?limit=5", { token });

    const lines = jsonLines(t.logs).filter((line) => line.msg === "Request");
    expect(lines).toEqual([
      expect.objectContaining({
        level: "debug",
        component: "http",
        method: "GET",
        path: "/api/events",
        status: 200,
        userId: user.id,
        durationMs: expect.any(Number) as unknown,
      }),
    ]);
    expect(t.logs.lines.join("")).not.toContain(token);
  });

  it("logs refused requests too, without a user", async () => {
    const t = await testApp();

    await t.call("GET", "/api/auth/me");

    expect(jsonLines(t.logs)).toContainEqual(
      expect.objectContaining({ msg: "Request", status: 401, userId: null }),
    );
  });
});
