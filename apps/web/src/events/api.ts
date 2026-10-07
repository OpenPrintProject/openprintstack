// SPDX-FileCopyrightText: 2026 Open Print Stack contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { OpsEvent } from "@openprintstack/protocol";
import { infiniteQueryOptions } from "@tanstack/react-query";
import { z } from "zod";

import type { Api } from "../api/client.ts";
import { EVENT_LOG_KEY } from "../realtime/cache.ts";
import { type EventFilters, pageQuery } from "./filters.ts";

// The stored event log over REST: GET /api/events, newest first, 100 events a
// page (the server's default). Each page's nextCursor is the next, older
// page's `before`; null means there's nothing older.
//
//   ["events"]             every filtered log (the live tail's resync
//                          refetches them all: realtime/cache.ts)
//   ["events", filters]    one filtered log's pages

export type EventPage = {
  /** Newest first. */
  events: OpsEvent[];
  nextCursor: number | null;
  /** Each user the events name, by id. */
  users: Record<string, string>;
};

/**
 * A page's events are checked against protocol's OpsEvent, as the realtime
 * client checks the socket's. That also types them: openapi-fetch's response
 * types drop a property whose type is only null, such as a global event's
 * `printerId: null`.
 */
const Events = z.array(OpsEvent);

export const eventLogKeys = {
  all: EVENT_LOG_KEY,
  list: (filters: EventFilters) => [...EVENT_LOG_KEY, filters],
} as const;

/** The first page has no cursor. */
const FIRST_PAGE: number | null = null;

export function eventLogQuery(api: Api, filters: EventFilters) {
  return infiniteQueryOptions({
    queryKey: eventLogKeys.list(filters),
    queryFn: async ({ pageParam, signal }): Promise<EventPage> => {
      const { data, error } = await api.client.GET("/api/events", {
        params: {
          query: {
            ...pageQuery(filters),
            ...(pageParam !== null && { before: pageParam }),
          },
        },
        signal,
      });
      // Thrown as it came, as openapi-react-query's queries do, so that
      // api/errors.ts can read it.
      if (error !== undefined) throw error as unknown;
      return { ...data, events: Events.parse(data.events) };
    },
    initialPageParam: FIRST_PAGE,
    getNextPageParam: (page) => page.nextCursor,
  });
}
