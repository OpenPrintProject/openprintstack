// SPDX-FileCopyrightText: 2026 Open Print Stack contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from "vitest";

import { eventFixtures, PRINTER_ID } from "./fixtures.ts";
import { EVENT_CATEGORY, EventCategory, EventType, OpsEvent } from "./index.ts";

describe("EVENT_CATEGORY", () => {
  it("covers every event type and nothing else", () => {
    expect(Object.keys(EVENT_CATEGORY).sort()).toEqual(
      [...EventType.options].sort(),
    );
  });

  it("maps every type to a known category", () => {
    for (const category of Object.values(EVENT_CATEGORY)) {
      expect(EventCategory.options).toContain(category);
    }
  });
});

describe("OpsEvent", () => {
  it("has exactly one schema per event type, stamped with its category", () => {
    const schemas = OpsEvent.options.map((option) => [
      option.shape.type.value,
      option.shape.category.value,
    ]);

    expect(schemas.map(([type]) => type).sort()).toEqual(
      [...EventType.options].sort(),
    );
    for (const [type, category] of schemas) {
      expect(category).toBe(EVENT_CATEGORY[type as EventType]);
    }
  });

  it("has a fixture for every event type", () => {
    for (const [type, event] of Object.entries(eventFixtures)) {
      expect(event.type).toBe(type);
      expect(OpsEvent.parse(event)).toStrictEqual(event);
    }
  });

  it("rejects a category that doesn't match the type", () => {
    const event = { ...eventFixtures["printer.telemetry"], category: "state" };

    expect(OpsEvent.safeParse(event).success).toBe(false);
  });

  it("rejects an unknown event type", () => {
    const event = {
      ...eventFixtures["system.stopping"],
      type: "system.exploded",
    };

    expect(OpsEvent.safeParse(event).success).toBe(false);
  });

  it("requires a UUIDv7 id", () => {
    const event = {
      ...eventFixtures["system.started"],
      id: "6f1c2b8e-3d4a-4c5b-9e6f-7a8b9c0d1e2f",
    };

    expect(OpsEvent.safeParse(event).success).toBe(false);
  });

  it.each([
    ["a Date", new Date("2026-10-05T12:00:00.000Z")],
    ["epoch milliseconds", 1_791_201_600_000],
    ["a local time", "2026-10-05T12:00:00"],
    ["a space-separated time", "2026-10-05 12:00:00Z"],
  ])("rejects a timestamp given as %s", (_name, ts) => {
    const event = { ...eventFixtures["system.started"], ts };

    expect(OpsEvent.safeParse(event).success).toBe(false);
  });

  it("requires a printerId on printer and command events", () => {
    for (const type of ["printer.telemetry", "command.requested"] as const) {
      const event = { ...eventFixtures[type], printerId: null };

      expect(OpsEvent.safeParse(event).success).toBe(false);
    }
  });

  it("requires a null printerId on auth and system events", () => {
    for (const type of ["auth.logout", "system.started"] as const) {
      const event = { ...eventFixtures[type], printerId: PRINTER_ID };

      expect(OpsEvent.safeParse(event).success).toBe(false);
    }
  });

  it("requires a userId when a user is the source", () => {
    const event = {
      ...eventFixtures["auth.logout"],
      source: { kind: "user" },
    };

    expect(OpsEvent.safeParse(event).success).toBe(false);
  });

  it("checks the payload against the event type", () => {
    const event = {
      ...eventFixtures["command.requested"],
      payload: {
        commandId: "c1",
        command: { kind: "fan.set", fanId: "part", percent: 150 },
      },
    };

    expect(OpsEvent.safeParse(event).success).toBe(false);
  });
});
