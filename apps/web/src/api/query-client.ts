// SPDX-FileCopyrightText: 2026 Open Print Stack contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { QueryClient } from "@tanstack/react-query";

import { isRetryable } from "./errors.ts";

/** How many times a failed query is tried again, at most. */
export const QUERY_RETRIES = 2;

export type QueryClientOptions = {
  /** For tests: TanStack Query waits 1 s, then 2 s, before retries. */
  retryDelayMs?: number;
};

/**
 * The app's TanStack Query client. Queries are retried only when the server
 * was unreachable or failed (5xx), never for a 4xx; mutations never are, so a
 * command can't run twice.
 */
export function createQueryClient(
  options: QueryClientOptions = {},
): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: (failures, error) =>
          failures < QUERY_RETRIES && isRetryable(error),
        ...(options.retryDelayMs !== undefined && {
          retryDelay: options.retryDelayMs,
        }),
      },
      mutations: { retry: false },
    },
  });
}
