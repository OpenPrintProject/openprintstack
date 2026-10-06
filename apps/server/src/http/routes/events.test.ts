// SPDX-FileCopyrightText: 2026 Open Print Stack contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { EventType, OpsEvent } from "@openprintstack/protocol";
import { eventFixtures, eventId } from "@openprintstack/protocol/fixtures";
import { describe, expect, it } from "vitest";

import { apiError, testApp } from "../test-app.ts";
import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE } from "./events.ts";

type Page = {
  events: OpsEvent[];
  nextCursor: number | null;
  users: Record<string, string>;
};

let next = 5000;

/** A stored copy of a fixture with its own id, for a printer and user. */
function copy(
  type: EventType,
  options: { printerId?: string; userId?: string } = {},
): OpsEvent {
  const fixture = eventFixtures[type];
  return {
    ...fixture,
    id: eventId(next++),
    ...(fixture.printerId !== null && {
      printerId: options.printerId ?? "printer-1",
    }),
    ...(fixture.source.kind === "user" &&
      options.userId !== undefined && {
        source: { kind: "user", userId: options.userId },
      }),
  } as OpsEvent;
}

async function withEvents(make: (userId: string) => OpsEvent[]) {
  const t = await testApp();
  const { token, user } = await t.setupAdmin();
  const list = make(user.id);
  for (const event of list) t.repos.events.insertMany([event]);
  const page = async (query = "") => {
    const answer = await t.call("GET", `/api/events${query}`, { token });
    expect(answer.status, await answer.clone().text()).toBe(200);
    return (await answer.json()) as Page;
  };
  return { ...t, token, user, list, page };
}

const ids = (events: readonly OpsEvent[]) => events.map((event) => event.id);

describe("GET /api/events", () => {
  it("pages newest first, following nextCursor to the end", async () => {
    const t = await withEvents(() =>
      Array.from({ length: 7 }, () => copy("command.result")),
    );

    const pages: Page[] = [await t.page("?limit=3")];
    // At most 10 pages, so a cursor that doesn't move fails instead of hanging.
    while (pages.at(-1)?.nextCursor != null && pages.length < 10) {
      pages.push(await t.page(`?limit=3&before=${pages.at(-1)?.nextCursor}`));
    }

    expect(pages.map((page) => page.events.length)).toEqual([3, 3, 1]);
    expect(ids(pages.flatMap((page) => page.events))).toEqual(
      ids([...t.list].reverse()),
    );
    expect(pages.at(-1)?.nextCursor).toBeNull();
  });

  it("returns 100 by default, and up to 500", async () => {
    expect([DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE]).toEqual([100, 500]);
    const t = await withEvents(() =>
      Array.from({ length: 101 }, () => copy("command.requested")),
    );

    const first = await t.page();
    const all = await t.page("?limit=500");

    expect(first.events).toHaveLength(100);
    expect(first.nextCursor).not.toBeNull();
    expect(all.events).toHaveLength(101);
    expect(all.nextCursor).toBeNull();
  });

  describe("telemetry", () => {
    const make = () => [
      copy("printer.status_changed"),
      copy("printer.telemetry"),
      copy("command.result"),
    ];

    it("is left out by default", async () => {
      const t = await withEvents(make);

      expect(ids((await t.page()).events)).toEqual(
        ids([t.list[2]!, t.list[0]!]),
      );
      expect(ids((await t.page("?includeTelemetry=false")).events)).toEqual(
        ids([t.list[2]!, t.list[0]!]),
      );
    });

    it.each([
      ["includeTelemetry=true", "?includeTelemetry=true", [2, 1, 0]],
      ["a type filter naming it", "?type=printer.telemetry", [1]],
      [
        "a category filter naming it",
        "?category=telemetry&category=command",
        [2, 1],
      ],
    ])("is included with %s", async (_, query, expected) => {
      const t = await withEvents(make);

      expect(ids((await t.page(query)).events)).toEqual(
        ids(expected.map((n) => t.list[n]!)),
      );
    });
  });

  describe("filters", () => {
    const make = (userId: string) => [
      copy("printer.status_changed", { printerId: "a" }),
      copy("command.requested", { printerId: "b", userId }),
      copy("command.result", { printerId: "a", userId }),
      copy("auth.login_failed"),
      copy("printer.alert", { printerId: "b" }),
    ];

    it.each([
      ["a printer", "?printerId=b", [4, 1]],
      ["one type", "?type=command.result", [2]],
      ["several types", "?type=command.result&type=auth.login_failed", [3, 2]],
      ["a category", "?category=state", [4, 0]],
      ["printer and category", "?printerId=a&category=command", [2]],
    ])("keeps %s", async (_, query, expected) => {
      const t = await withEvents(make);

      expect(ids((await t.page(query)).events)).toEqual(
        ids(expected.map((n) => t.list[n]!)),
      );
    });
  });

  it("names the users the page's events mention", async () => {
    const t = await withEvents((userId) => [
      copy("command.requested", { userId }),
      copy("command.result", {
        userId: "0199b3a0-1c00-7000-8000-0000000000ff",
      }),
      copy("system.started"),
    ]);

    const page = await t.page();

    expect(page.users).toEqual({ [t.user.id]: "rob" });
  });

  it("names no one on a page without user events", async () => {
    const t = await withEvents(() => [copy("system.started")]);

    expect((await t.page()).users).toEqual({});
  });

  it.each([
    "?limit=0",
    "?limit=501",
    "?limit=ten",
    "?limit=1.5",
    "?before=0",
    "?before=-1",
    "?type=printer.exploded",
    "?category=gossip",
    "?includeTelemetry=yes",
    "?printerId=a&printerId=b",
  ])("refuses %s with 400", async (query) => {
    const t = await withEvents(() => []);

    const answer = await t.call("GET", `/api/events${query}`, {
      token: t.token,
    });

    expect(answer.status).toBe(400);
    expect((await apiError(answer)).code).toBe("validation_failed");
  });
});
