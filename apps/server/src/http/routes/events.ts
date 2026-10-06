// SPDX-FileCopyrightText: 2026 Open Print Stack contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { createRoute } from "@hono/zod-openapi";
import {
  EventCategory,
  EventType,
  Id,
  OpsEvent,
} from "@openprintstack/protocol";
import { z } from "zod";

import { requireSession } from "../middleware/session.ts";
import { errorResponses, jsonResponse, SESSION_SECURITY } from "../schemas.ts";
import { newRoutes } from "../validation.ts";

// The persisted event log, newest first, paged by row_id: each page's
// nextCursor is the next page's `before`. Events written after the first page
// never appear in older pages; the WebSocket's events topic carries those.

export const DEFAULT_PAGE_SIZE = 100;
export const MAX_PAGE_SIZE = 500;

/** One value or several: ?type=a&type=b arrives as an array. */
function oneOrMany<T extends z.ZodType>(item: T) {
  return z.union([item, z.array(item)]);
}

const EventsQuery = z.object({
  printerId: Id.optional().meta({ description: "Only this printer's events." }),
  type: oneOrMany(EventType)
    .optional()
    .meta({ description: "Only these types. Repeat it for several." }),
  category: oneOrMany(EventCategory)
    .optional()
    .meta({ description: "Only these categories. Repeat it for several." }),
  includeTelemetry: z.enum(["true", "false"]).optional().meta({
    description:
      "Telemetry is left out unless this is true, or type or category names it.",
  }),
  before: z.coerce
    .number()
    .int()
    .positive()
    .optional()
    .meta({ description: "The previous page's nextCursor." }),
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .max(MAX_PAGE_SIZE)
    .optional()
    .meta({
      description: `At most this many events (default ${DEFAULT_PAGE_SIZE}).`,
    }),
});

const EventPage = z
  .object({
    events: z.array(OpsEvent).meta({ description: "Newest first." }),
    nextCursor: z.int().positive().nullable().meta({
      description:
        "The `before` for the next, older page; null when there's nothing older.",
    }),
    users: z.record(Id, z.string()).meta({
      description:
        "The username of each user these events name, by id. A deleted user isn't here.",
    }),
  })
  .meta({ id: "EventPage" });

const listEvents = createRoute({
  method: "get",
  path: "/api/events",
  operationId: "listEvents",
  tags: ["events"],
  summary: "The event log, newest first",
  security: SESSION_SECURITY,
  middleware: requireSession,
  request: { query: EventsQuery },
  responses: {
    200: jsonResponse(EventPage, "One page of events."),
    ...errorResponses(400, 401),
  },
});

export function eventRoutes() {
  const routes = newRoutes();

  routes.openapi(listEvents, (c) => {
    const { repos } = c.var.deps;
    const query = c.req.valid("query");
    const page = repos.events.page({
      ...(query.printerId !== undefined && { printerId: query.printerId }),
      types: list(query.type),
      categories: list(query.category),
      includeTelemetry: query.includeTelemetry === "true",
      ...(query.before !== undefined && { before: query.before }),
      limit: query.limit ?? DEFAULT_PAGE_SIZE,
    });
    const userIds = page.events.flatMap((event) =>
      event.source.kind === "user" ? [event.source.userId] : [],
    );
    return c.json(
      { ...page, users: Object.fromEntries(repos.users.usernames(userIds)) },
      200,
    );
  });

  return routes;
}

function list<T>(value: T | T[] | undefined): T[] {
  return value === undefined ? [] : Array.isArray(value) ? value : [value];
}
