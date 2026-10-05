// SPDX-FileCopyrightText: 2026 Open Print Stack contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from "vitest";

import {
  COMMAND_POLICY,
  CommandKind,
  ONLINE_STATUSES,
  PrinterStatus,
} from "./index.ts";

describe("COMMAND_POLICY", () => {
  it("covers every command kind and nothing else", () => {
    expect(Object.keys(COMMAND_POLICY).sort()).toEqual(
      [...CommandKind.options].sort(),
    );
  });

  it("only lists real statuses", () => {
    for (const policy of Object.values(COMMAND_POLICY)) {
      for (const status of policy.allowedStatuses) {
        expect(PrinterStatus.options).toContain(status);
      }
    }
  });

  it("matches the agreed table", () => {
    const heatAndFans = [
      "idle",
      "busy",
      "preparing",
      "printing",
      "pausing",
      "paused",
    ];
    const allowed = Object.fromEntries(
      Object.entries(COMMAND_POLICY).map(([kind, policy]) => [
        kind,
        new Set(policy.allowedStatuses),
      ]),
    );

    expect(allowed).toStrictEqual({
      "print.start": new Set(["idle"]),
      "print.pause": new Set(["preparing", "printing"]),
      "print.resume": new Set(["paused"]),
      "print.cancel": new Set([
        "preparing",
        "printing",
        "pausing",
        "paused",
        "error",
      ]),
      "motion.home": new Set(["idle"]),
      "motion.move": new Set(["idle"]),
      "temperature.set": new Set(heatAndFans),
      "fan.set": new Set(heatAndFans),
      "file.upload": new Set(ONLINE_STATUSES),
      "extension.invoke": new Set(PrinterStatus.options),
    });
  });

  it("only lets extension.invoke reach an offline printer", () => {
    for (const kind of CommandKind.options) {
      expect(COMMAND_POLICY[kind].requiresOnline).toBe(
        kind !== "extension.invoke",
      );
    }
  });

  it("never allows a command that requires online in an offline status", () => {
    for (const policy of Object.values(COMMAND_POLICY)) {
      if (!policy.requiresOnline) continue;
      expect(policy.allowedStatuses).not.toContain("offline");
      expect(policy.allowedStatuses).not.toContain("connecting");
    }
  });
});
