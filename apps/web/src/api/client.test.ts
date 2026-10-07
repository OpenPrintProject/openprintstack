// SPDX-FileCopyrightText: 2026 Open Print Stack contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it, vi } from "vitest";

import { apiError } from "../test/fake-server.ts";
import { createApi, signedOutReason } from "./client.ts";

function setup(answer: () => Response | Promise<Response>) {
  const onSignedOut = vi.fn();
  const api = createApi({
    baseUrl: "http://localhost:5173",
    fetch: () => Promise.resolve(answer()),
    onSignedOut,
  });
  return { api, onSignedOut };
}

describe("a 401 that ends the session", () => {
  it.each(["setup_required", "unauthenticated"] as const)(
    "calls onSignedOut with %s",
    async (code) => {
      const { api, onSignedOut } = setup(() => apiError(401, code, "No."));

      const { error } = await api.client.GET("/api/printers");

      expect(onSignedOut.mock.calls).toEqual([[code]]);
      expect(error).toEqual({ error: { code, message: "No." } });
    },
  );

  it("isn't a wrong password (invalid_credentials), which the login form shows", async () => {
    const { api, onSignedOut } = setup(() =>
      apiError(
        401,
        "invalid_credentials",
        "The username or password is wrong.",
      ),
    );

    await api.client.POST("/api/auth/login", {
      body: { username: "rob", password: "nope" },
    });

    expect(onSignedOut).not.toHaveBeenCalled();
  });

  it("is left to the session check's callers", async () => {
    const { api, onSignedOut } = setup(() =>
      apiError(401, "unauthenticated", "Log in first."),
    );

    await api.client.GET("/api/auth/me");

    expect(onSignedOut).not.toHaveBeenCalled();
  });

  it.each([
    [
      "another status with the same code",
      () => apiError(403, "unauthenticated", "No."),
    ],
    [
      "a 401 without an ApiError body",
      () => new Response("Unauthorized", { status: 401 }),
    ],
  ])("isn't %s", async (_, answer) => {
    const { api, onSignedOut } = setup(answer);

    await api.client.GET("/api/printers");

    expect(onSignedOut).not.toHaveBeenCalled();
  });
});

describe("error answers", () => {
  it("are the server's ApiError body", async () => {
    const { api } = setup(() =>
      apiError(404, "printer_not_found", "There is no printer x."),
    );

    const { error, response } = await api.client.GET("/api/printers/{id}", {
      params: { path: { id: "x" } },
    });

    expect(response.status).toBe(404);
    expect(error).toEqual({
      error: { code: "printer_not_found", message: "There is no printer x." },
    });
  });

  it.each([
    [
      "empty, as Vite's proxy answers while the server is down",
      () =>
        new Response(null, {
          status: 502,
          headers: { "Content-Type": "text/plain", "Content-Length": "0" },
        }),
      502,
    ],
    ["plain text", () => new Response("Bad Gateway", { status: 502 }), 502],
    [
      "JSON that isn't an ApiError",
      () => Response.json({ oops: true }, { status: 500 }),
      500,
    ],
  ])("get an ApiError body when they're %s", async (_, answer, status) => {
    const { api } = setup(answer);

    const { error, response } = await api.client.GET("/api/printers");

    expect(response.status).toBe(status);
    expect(error).toEqual({
      error: {
        code: "unexpected_response",
        message: `The server answered with HTTP ${status} and no explanation. Check that it's running, then try again.`,
        details: { status },
      },
    });
  });

  it("leave successful answers alone", async () => {
    const { api } = setup(() => Response.json({ printers: [] }));

    const { data, error } = await api.client.GET("/api/printers");

    expect(data).toEqual({ printers: [] });
    expect(error).toBeUndefined();
  });

  it("make openapi-react-query's queries fail rather than succeed with null", async () => {
    const { api } = setup(() => new Response(null, { status: 502 }));
    const { queryFn, queryKey } = api.query.queryOptions(
      "get",
      "/api/printers",
    );

    await expect(
      queryFn({ queryKey, signal: new AbortController().signal } as never),
    ).rejects.toMatchObject({ error: { code: "unexpected_response" } });
  });
});

describe("signedOutReason", () => {
  it.each([
    [{ error: { code: "setup_required", message: "" } }, "setup_required"],
    [{ error: { code: "unauthenticated", message: "" } }, "unauthenticated"],
    [{ error: { code: "invalid_credentials", message: "" } }, undefined],
    [new TypeError("Failed to fetch"), undefined],
    ["unauthenticated", undefined],
  ] as const)("reads %j as %s", (error, reason) => {
    expect(signedOutReason(error)).toBe(reason);
  });
});
