// SPDX-FileCopyrightText: 2026 Open Print Stack contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from "vitest";

import {
  eventFixtures,
  PRINTER_ID,
  snapshotFixture,
  wsClientMessageFixtures,
  wsServerMessageFixtures,
} from "./fixtures.ts";
import {
  EventType,
  matchesTopic,
  type OpsEvent,
  type Topic,
  topicKey,
  WsClientMessage,
  WsServerMessage,
} from "./index.ts";

describe("WsClientMessage", () => {
  it("accepts every fixture", () => {
    for (const message of wsClientMessageFixtures) {
      expect(WsClientMessage.parse(message)).toStrictEqual(message);
    }
  });

  it("rejects an unknown topic", () => {
    const message = { type: "subscribe", topic: { name: "everything" } };

    expect(WsClientMessage.safeParse(message).success).toBe(false);
  });

  it("rejects a printer topic without a printer", () => {
    const message = { type: "subscribe", topic: { name: "printer" } };

    expect(WsClientMessage.safeParse(message).success).toBe(false);
  });

  it("rejects an unknown event type in an events filter", () => {
    const message = {
      type: "subscribe",
      topic: { name: "events", types: ["printer.exploded"] },
    };

    expect(WsClientMessage.safeParse(message).success).toBe(false);
  });
});

describe("WsServerMessage", () => {
  it("accepts every fixture", () => {
    for (const message of wsServerMessageFixtures) {
      expect(WsServerMessage.parse(message)).toStrictEqual(message);
    }
  });

  it.each([
    ["fleet", { name: "fleet" }, snapshotFixture],
    ["printer", { name: "printer", printerId: PRINTER_ID }, [snapshotFixture]],
    ["events", { name: "events" }, [snapshotFixture]],
  ])(
    "rejects a %s snapshot whose data doesn't match the topic",
    (_name, topic, data) => {
      const message = { type: "snapshot", topic, seq: 1, data };

      expect(WsServerMessage.safeParse(message).success).toBe(false);
    },
  );
});

describe("topicKey", () => {
  it("tells topics apart", () => {
    const keys = [
      topicKey({ name: "fleet" }),
      topicKey({ name: "printer", printerId: PRINTER_ID }),
      topicKey({ name: "printer", printerId: "printer-2" }),
      topicKey({ name: "events" }),
      topicKey({ name: "events", printerId: PRINTER_ID }),
      topicKey({ name: "events", types: ["auth.logout"] }),
      topicKey({ name: "events", includeTelemetry: true }),
    ];

    expect(new Set(keys).size).toBe(keys.length);
  });

  it("compares the events topic's filters by meaning", () => {
    const key = topicKey({
      name: "events",
      types: ["command.result", "command.requested"],
    });

    expect(
      topicKey({
        name: "events",
        types: ["command.requested", "command.result", "command.requested"],
        includeTelemetry: false,
      }),
    ).toBe(key);
    expect(topicKey({ name: "events", types: [] })).toBe(
      topicKey({ name: "events", includeTelemetry: false }),
    );
  });

  it("keeps a printer id that looks like JSON apart from the filters", () => {
    expect(topicKey({ name: "events", printerId: '",[],false]' })).not.toBe(
      topicKey({ name: "events" }),
    );
  });
});

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
  "printer.filament_changed",
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
