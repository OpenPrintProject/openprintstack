// SPDX-FileCopyrightText: 2026 Open Print Stack contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { EVENT_CATEGORY, EventType } from "@openprintstack/protocol";
import { describe, expect, it } from "vitest";

import {
  type EventFilters,
  EventLogSearch,
  eventLogSearch,
  FILTER_TYPES,
  filtersOf,
  liveTopic,
  NO_FILTERS,
  pageQuery,
  parseTypes,
  TYPE_GROUPS,
} from "./filters.ts";

const COMMANDS: EventFilters = {
  printerId: "p1",
  types: ["command.requested", "command.result"],
  telemetry: false,
};

describe("the search params", () => {
  it("read into filters", () => {
    const search = EventLogSearch.parse({
      printer: "p1",
      types: "command.result command.requested",
      telemetry: true,
    });

    expect(filtersOf(search)).toEqual({ ...COMMANDS, telemetry: true });
    expect(filtersOf(EventLogSearch.parse({}))).toEqual(NO_FILTERS);
  });

  it("drop what doesn't make sense rather than refusing it", () => {
    expect(
      EventLogSearch.parse({
        printer: "",
        types: "nope, printer.alert ,printer.telemetry,printer.alert,",
        telemetry: "yes",
      }),
    ).toEqual({ types: "printer.alert" });
    expect(
      EventLogSearch.parse({ printer: 42, types: ["a"], telemetry: false }),
    ).toEqual({});
    expect(EventLogSearch.parse({ types: "" })).toEqual({});
  });

  it("give back what they're given once tidy, as the router writes it back", () => {
    const tidy = { printer: "p1", types: "printer.alert", telemetry: true };

    expect(EventLogSearch.parse(tidy)).toEqual(tidy);
    expect(EventLogSearch.parse(EventLogSearch.parse(tidy))).toEqual(tidy);
  });

  it("leave out what's unfiltered", () => {
    expect(eventLogSearch(NO_FILTERS)).toEqual({});
    expect(eventLogSearch({ printerId: "p1" })).toEqual({ printer: "p1" });
    expect(
      eventLogSearch({
        types: ["command.result", "printer.telemetry", "command.requested"],
        telemetry: true,
      }),
    ).toEqual({ types: "command.requested command.result", telemetry: true });
  });

  it("round-trip", () => {
    const filters: EventFilters = {
      printerId: "p1",
      types: ["printer.alert", "auth.logout"],
      telemetry: true,
    };

    expect(filtersOf(EventLogSearch.parse(eventLogSearch(filters)))).toEqual(
      filters,
    );
  });
});

describe("parseTypes", () => {
  it("keeps known types once each, in the catalogue's order, without telemetry", () => {
    expect(
      parseTypes(
        "system.stopping,printer.alert,x,printer.telemetry,,printer.alert",
      ),
    ).toEqual(["printer.alert", "system.stopping"]);
    expect(parseTypes("")).toEqual([]);
  });

  it("reads types separated by spaces (as the page writes them) or commas", () => {
    const both = ["printer.alert", "auth.logout"];

    expect(parseTypes("printer.alert auth.logout")).toEqual(both);
    expect(parseTypes("auth.logout,printer.alert")).toEqual(both);
    expect(parseTypes(" printer.alert ,  auth.logout ")).toEqual(both);
  });
});

describe("the Types filter's groups", () => {
  it("hold every type but telemetry once, under its category", () => {
    expect(TYPE_GROUPS.map((group) => group.category)).toEqual([
      "state",
      "command",
      "config",
      "auth",
      "system",
    ]);
    expect(TYPE_GROUPS.flatMap((group) => group.types)).toEqual(FILTER_TYPES);
    expect(FILTER_TYPES).toEqual(
      EventType.options.filter((type) => type !== "printer.telemetry"),
    );
    for (const group of TYPE_GROUPS) {
      for (const type of group.types) {
        expect(EVENT_CATEGORY[type]).toBe(group.category);
      }
    }
  });
});

describe("liveTopic", () => {
  it("carries the printer and types, and never telemetry", () => {
    expect(liveTopic(NO_FILTERS)).toEqual({ name: "events" });
    expect(liveTopic({ ...COMMANDS, telemetry: true })).toEqual({
      name: "events",
      printerId: "p1",
      types: ["command.requested", "command.result"],
    });
    expect(liveTopic({ ...NO_FILTERS, telemetry: true })).toEqual({
      name: "events",
    });
  });
});

describe("pageQuery", () => {
  it("asks GET /api/events for the same filters", () => {
    expect(pageQuery(NO_FILTERS)).toEqual({});
    expect(pageQuery(COMMANDS)).toEqual({
      printerId: "p1",
      type: ["command.requested", "command.result"],
    });
  });

  it("asks for telemetry, as one more type when types are chosen", () => {
    expect(pageQuery({ ...NO_FILTERS, telemetry: true })).toEqual({
      includeTelemetry: "true",
    });
    expect(pageQuery({ ...COMMANDS, telemetry: true })).toEqual({
      printerId: "p1",
      type: ["command.requested", "command.result", "printer.telemetry"],
      includeTelemetry: "true",
    });
  });
});
