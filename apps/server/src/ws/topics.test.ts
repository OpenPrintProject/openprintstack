// SPDX-FileCopyrightText: 2026 Open Print Stack contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { EventType, type OpsEvent, type Topic } from "@openprintstack/protocol";
import { eventFixtures, PRINTER_ID } from "@openprintstack/protocol/fixtures";
import { describe, expect, it } from "vitest";

import { matchesTopic } from "./topics.ts";

const OTHER = "printer-2";

/** The fixture of each type, for `printerId` (null stays null). */
function eventOf(type: EventType, printerId: string = PRINTER_ID): OpsEvent {
  const event = eventFixtures[type];
  return {
    ...event,
    printerId: event.printerId === null ? null : printerId,
  } as OpsEvent;
}

/** The types of every fixture the topic matches, in catalogue order. */
function matching(topic: Topic, printerId: string = PRINTER_ID): string[] {
  return EventType.options.filter((type) =>
    matchesTopic(topic, eventOf(type, printerId)),
  );
}

const PRINTER_TYPES = [
  "printer.telemetry",
  "printer.status_changed",
  "printer.capabilities_changed",
  "printer.alert",
  "printer.job_started",
  "printer.job_ended",
  "printer.files_changed",
  "command.requested",
  "command.result",
  "printer.added",
  "printer.updated",
  "printer.removed",
];

const GLOBAL_TYPES = [
  "auth.setup_completed",
  "auth.login_succeeded",
  "auth.login_failed",
  "auth.logout",
  "system.started",
  "system.stopping",
];

describe("matchesTopic", () => {
  it("gives fleet every event about any printer, telemetry included", () => {
    expect(matching({ name: "fleet" })).toEqual(PRINTER_TYPES);
    expect(matching({ name: "fleet" }, OTHER)).toEqual(PRINTER_TYPES);
  });

  it("gives a printer topic every event about that printer only", () => {
    const topic = { name: "printer", printerId: PRINTER_ID } as const;

    expect(matching(topic)).toEqual(PRINTER_TYPES);
    expect(matching(topic, OTHER)).toEqual([]);
  });

  it("gives the events topic everything but telemetry by default", () => {
    expect(matching({ name: "events" })).toEqual([
      ...PRINTER_TYPES.filter((type) => type !== "printer.telemetry"),
      ...GLOBAL_TYPES,
    ]);
  });

  it("includes telemetry when asked, or when types names it", () => {
    expect(matching({ name: "events", includeTelemetry: true })).toEqual([
      ...PRINTER_TYPES,
      ...GLOBAL_TYPES,
    ]);
    expect(
      matching({
        name: "events",
        types: ["printer.telemetry", "printer.alert"],
      }),
    ).toEqual(["printer.telemetry", "printer.alert"]);
    expect(matching({ name: "events", includeTelemetry: false })).not.toContain(
      "printer.telemetry",
    );
  });

  it("narrows the events topic to one printer, leaving out global events", () => {
    const topic = { name: "events", printerId: PRINTER_ID } as const;

    expect(matching(topic)).toEqual(
      PRINTER_TYPES.filter((type) => type !== "printer.telemetry"),
    );
    expect(matching(topic, OTHER)).toEqual([]);
  });

  it("narrows the events topic to its types, and treats [] as no filter", () => {
    expect(
      matching({
        name: "events",
        types: ["command.requested", "command.result", "auth.logout"],
      }),
    ).toEqual(["command.requested", "command.result", "auth.logout"]);
    expect(matching({ name: "events", types: [] })).toEqual(
      matching({ name: "events" }),
    );
  });

  it("combines the events topic's filters", () => {
    const topic: Topic = {
      name: "events",
      printerId: PRINTER_ID,
      types: ["printer.telemetry", "auth.logout", "printer.alert"],
    };

    expect(matching(topic)).toEqual(["printer.telemetry", "printer.alert"]);
    expect(matching(topic, OTHER)).toEqual([]);
  });
});
