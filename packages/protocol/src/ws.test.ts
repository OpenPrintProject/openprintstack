// SPDX-FileCopyrightText: 2026 Open Print Stack contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from "vitest";

import {
  PRINTER_ID,
  snapshotFixture,
  wsClientMessageFixtures,
  wsServerMessageFixtures,
} from "./fixtures.ts";
import { WsClientMessage, WsServerMessage } from "./index.ts";

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
