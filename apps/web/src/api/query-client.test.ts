// SPDX-FileCopyrightText: 2026 Open Print Stack contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from "vitest";

import { apiError } from "../test/fake-server.ts";
import { createApi } from "./client.ts";
import { createQueryClient } from "./query-client.ts";

/** Asks for the printers through the real API client; counts the tries. */
async function fetchPrinters(answer: () => Response): Promise<{
  tries: number;
  error: unknown;
}> {
  let tries = 0;
  const api = createApi({
    baseUrl: "http://localhost:5173",
    fetch: () => {
      tries += 1;
      return Promise.resolve(answer());
    },
    onSignedOut: () => {},
  });
  const queryClient = createQueryClient({ retryDelayMs: 1 });
  try {
    await queryClient.fetchQuery(
      api.query.queryOptions("get", "/api/printers"),
    );
    return { tries, error: undefined };
  } catch (error) {
    return { tries, error };
  }
}

describe("createQueryClient", () => {
  it.each([
    [
      "the server can't be reached",
      (): Response => {
        throw new TypeError("Failed to fetch");
      },
    ],
    ["the server fails (500)", () => apiError(500, "internal", "Oops.")],
    [
      "Vite's proxy can't reach it (an empty 502)",
      () => new Response(null, { status: 502 }),
    ],
  ])("tries a query 3 times in all when %s", async (_, answer) => {
    const { tries, error } = await fetchPrinters(answer);

    expect(tries).toBe(3);
    expect(error).toBeDefined();
  });

  it.each([
    ["401", () => apiError(401, "unauthenticated", "Log in first.")],
    ["404", () => apiError(404, "printer_not_found", "There is no printer x.")],
    ["409", () => apiError(409, "printer_busy", "The printer is busy.")],
  ])("doesn't retry a %s", async (_, answer) => {
    const { tries } = await fetchPrinters(answer);

    expect(tries).toBe(1);
  });

  it("never retries a mutation", () => {
    const queryClient = createQueryClient();

    expect(queryClient.getDefaultOptions().mutations?.retry).toBe(false);
  });
});
