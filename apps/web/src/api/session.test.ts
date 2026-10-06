// SPDX-FileCopyrightText: 2026 Open Print Stack contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from "vitest";

import { FakeServer, ROB } from "../test/fake-server.ts";
import { createApi } from "./client.ts";
import { createQueryClient } from "./query-client.ts";
import { sessionStatus } from "./session.ts";

function setup(server: FakeServer) {
  const api = createApi({
    baseUrl: "http://localhost:5173",
    fetch: server.fetch,
    onSignedOut: () => {},
  });
  return { api, queryClient: createQueryClient({ retryDelayMs: 1 }) };
}

describe("sessionStatus", () => {
  it("is active with the user, and asks the server only once", async () => {
    const server = FakeServer.withUser({ loggedIn: true });
    const context = setup(server);

    const first = await sessionStatus(context);
    const second = await sessionStatus(context);

    expect(first).toEqual({
      kind: "active",
      user: { id: ROB.id, username: "rob" },
    });
    expect(second).toEqual(first);
    expect(server.requestsTo("GET /api/auth/me")).toHaveLength(1);
  });

  it.each([
    ["no user exists", new FakeServer(), "setup_required"],
    ["not logged in", FakeServer.withUser(), "unauthenticated"],
  ] as const)("is %s when %s", async (_, server, kind) => {
    expect(await sessionStatus(setup(server))).toEqual({ kind });
  });

  it("throws when the server can't say", async () => {
    const server = FakeServer.withUser();
    server.mode = "network";

    await expect(sessionStatus(setup(server))).rejects.toThrow(
      "Failed to fetch",
    );
  });

  it("asks the server again once the cache has been cleared (as signing out does)", async () => {
    const server = FakeServer.withUser({ loggedIn: true });
    const context = setup(server);
    await sessionStatus(context);

    server.session = null;
    context.queryClient.clear();

    expect(await sessionStatus(context)).toEqual({ kind: "unauthenticated" });
    expect(server.requestsTo("GET /api/auth/me")).toHaveLength(2);
  });
});
