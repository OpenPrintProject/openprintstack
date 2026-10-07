// SPDX-FileCopyrightText: 2026 Open Print Stack contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  EVENT_CATEGORY,
  type EventCategory,
  EventType,
  type Topic,
} from "@openprintstack/protocol";
import { z } from "zod";

// The event log's filters, kept in the page's address so a filtered log can
// be bookmarked or shared:
//
//   /events?printer=<id>&types=command.requested+command.result&telemetry=true
//
//   printer    one printer's events (a deleted printer's too)
//   types      only these types, separated by spaces (which the address shows
//              as +; the router percent-encodes commas, so they're only read).
//              The Types filter's categories are shortcuts for their types,
//              so the server's category filter isn't used. Never
//              printer.telemetry: the switch is for that
//   telemetry  true: the stored telemetry samples too
//
// Values that don't make sense are dropped, not refused: an unknown type, an
// empty printer, a telemetry that isn't true. The router writes what the
// schema gives back into the address, so it gives back the same shape, tidied.
//
// The same filters go to GET /api/events and to the live tail's events topic,
// except that the tail never carries telemetry: every row on the page is a
// stored event, and the server stores telemetry only every few seconds while
// the topic would send every update.

export type EventFilters = {
  printerId: string | undefined;
  /** In the catalogue's order; empty means every type. */
  types: EventType[];
  telemetry: boolean;
};

export const NO_FILTERS: EventFilters = {
  printerId: undefined,
  types: [],
  telemetry: false,
};

/** The types the Types filter offers: every type but telemetry. */
export const FILTER_TYPES: readonly EventType[] = EventType.options.filter(
  (type) => type !== "printer.telemetry",
);

/** The Types filter's groups: each category but telemetry, with its types. */
export const TYPE_GROUPS: readonly {
  category: EventCategory;
  types: readonly EventType[];
}[] = (["state", "command", "config", "auth", "system"] as const).map(
  (category) => ({
    category,
    types: FILTER_TYPES.filter((type) => EVENT_CATEGORY[type] === category),
  }),
);

/** The route's search params. */
export const EventLogSearch = z.object({
  printer: z.string().min(1).optional().catch(undefined),
  types: z
    .string()
    .optional()
    .catch(undefined)
    .transform((text) => {
      const types = parseTypes(text ?? "");
      return types.length === 0 ? undefined : types.join(" ");
    }),
  telemetry: z.literal(true).optional().catch(undefined),
});

export type EventLogSearch = z.output<typeof EventLogSearch>;

/** The filters the search params ask for. */
export function filtersOf(search: EventLogSearch): EventFilters {
  return {
    printerId: search.printer,
    types: parseTypes(search.types ?? ""),
    telemetry: search.telemetry === true,
  };
}

/**
 * "a b" (or "a,b") → the known filter types among them, in the catalogue's
 * order.
 */
export function parseTypes(text: string): EventType[] {
  const named = new Set(text.split(/[\s,]+/));
  return FILTER_TYPES.filter((type) => named.has(type));
}

/** The search params for these filters, leaving out what's unfiltered. */
export function eventLogSearch(
  filters: Partial<EventFilters>,
): z.input<typeof EventLogSearch> {
  const types = parseTypes((filters.types ?? []).join(" "));
  return {
    ...(filters.printerId !== undefined && { printer: filters.printerId }),
    ...(types.length > 0 && { types: types.join(" ") }),
    ...(filters.telemetry === true && { telemetry: true }),
  };
}

/** The live tail's topic: the same filters, without telemetry. */
export function liveTopic(filters: EventFilters): Topic {
  return {
    name: "events",
    ...(filters.printerId !== undefined && { printerId: filters.printerId }),
    ...(filters.types.length > 0 && { types: filters.types }),
  };
}

/**
 * GET /api/events's query for these filters. With types chosen, telemetry is
 * one more type (the server's type filter would leave it out otherwise).
 */
export function pageQuery(filters: EventFilters): {
  printerId?: string;
  type?: EventType[];
  includeTelemetry?: "true";
} {
  const types =
    filters.telemetry && filters.types.length > 0
      ? [...filters.types, "printer.telemetry" as const]
      : filters.types;
  return {
    ...(filters.printerId !== undefined && { printerId: filters.printerId }),
    ...(types.length > 0 && { type: types }),
    ...(filters.telemetry && { includeTelemetry: "true" }),
  };
}
