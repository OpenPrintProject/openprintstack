// SPDX-FileCopyrightText: 2026 Open Print Stack contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from "vitest";

import { commandFixtures } from "./fixtures.ts";
import { CommandKind, PrinterCommand } from "./index.ts";

describe("PrinterCommand", () => {
  it("has exactly one schema per command kind", () => {
    const kinds = PrinterCommand.options.map(
      (option) => option.shape.kind.value,
    );

    expect(kinds.sort()).toEqual([...CommandKind.options].sort());
  });

  it("accepts a fixture of every kind", () => {
    for (const [kind, command] of Object.entries(commandFixtures)) {
      expect(command.kind).toBe(kind);
      expect(PrinterCommand.parse(command)).toStrictEqual(command);
    }
  });

  it("rejects an unknown kind", () => {
    expect(PrinterCommand.safeParse({ kind: "print.explode" }).success).toBe(
      false,
    );
  });

  describe("motion.move", () => {
    it.each([
      ["only a speed", { speedMmS: 50 }],
      ["nothing", {}],
    ])("rejects a move with %s", (_name, fields) => {
      const move = { kind: "motion.move", ...fields };

      expect(PrinterCommand.safeParse(move).success).toBe(false);
    });

    it.each([
      ["x", { x: -10 }],
      ["y", { y: 5 }],
      ["z, even 0", { z: 0 }],
    ])("accepts a move along %s", (_name, fields) => {
      const move = { kind: "motion.move", ...fields };

      expect(PrinterCommand.safeParse(move).success).toBe(true);
    });

    it("requires a positive speed", () => {
      const move = { kind: "motion.move", x: 1, speedMmS: 0 };

      expect(PrinterCommand.safeParse(move).success).toBe(false);
    });
  });

  describe("unit bounds", () => {
    it.each([
      ["a negative target", { kind: "temperature.set", targetC: -1 }],
      ["fan above 100%", { kind: "fan.set", percent: 100.5 }],
      ["fan below 0%", { kind: "fan.set", percent: -1 }],
      ["a fractional size", { kind: "file.upload", sizeBytes: 1.5 }],
      ["a negative size", { kind: "file.upload", sizeBytes: -1 }],
    ] as const)("rejects %s", (_name, change) => {
      const command = { ...commandFixtures[change.kind], ...change };

      expect(PrinterCommand.safeParse(command).success).toBe(false);
    });

    it.each([
      [
        "0 °C, which turns a heater off",
        { kind: "temperature.set", targetC: 0 },
      ],
      ["fan at 0%", { kind: "fan.set", percent: 0 }],
      ["fan at 100%", { kind: "fan.set", percent: 100 }],
      ["an empty file", { kind: "file.upload", sizeBytes: 0 }],
    ] as const)("accepts %s", (_name, change) => {
      const command = { ...commandFixtures[change.kind], ...change };

      expect(PrinterCommand.safeParse(command).success).toBe(true);
    });
  });

  describe("extension.invoke", () => {
    it.each([
      ["a function", () => 1],
      ["a Date", new Date()],
      ["a Map", new Map()],
      ["undefined", undefined],
    ])("rejects %s as params", (_name, params) => {
      const command = { ...commandFixtures["extension.invoke"], params };

      expect(PrinterCommand.safeParse(command).success).toBe(false);
    });
  });
});
