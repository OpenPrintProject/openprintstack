// SPDX-FileCopyrightText: 2026 Open Print Stack contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from "vitest";
import { z } from "zod";

import { testDatabase } from "../../test-utils.ts";
import { PrintersRepo } from "./printers.ts";

const SETTINGS = { printDurationS: 600, cameraEnabled: true, label: "Bench" };

async function repo(): Promise<PrintersRepo> {
  return new PrintersRepo(await testDatabase());
}

describe("PrintersRepo", () => {
  it("creates a printer at settings version 1", async () => {
    const printers = await repo();

    const printer = printers.create({
      name: "Prusa",
      driverType: "simulated",
      settings: SETTINGS,
      now: 1000,
    });

    const { id, ...rest } = printer;
    expect(z.uuidv7().safeParse(id).success).toBe(true);
    expect(rest).toEqual({
      name: "Prusa",
      driverType: "simulated",
      settings: SETTINGS,
      settingsVersion: 1,
      createdAt: 1000,
      updatedAt: 1000,
    });
  });

  it("finds a printer by id, with its settings as they were given", async () => {
    const printers = await repo();
    const printer = printers.create({
      name: "Prusa",
      driverType: "simulated",
      settings: SETTINGS,
      now: 1,
    });

    expect(printers.findById(printer.id)).toEqual(printer);
    expect(printers.findById("nobody")).toBeUndefined();
  });

  it("stores the settings as readable JSON", async () => {
    const db = await testDatabase();
    const printer = new PrintersRepo(db).create({
      name: "Prusa",
      driverType: "simulated",
      settings: SETTINGS,
      now: 1,
    });

    expect(
      db.$client
        .prepare("SELECT settings FROM printers WHERE id = ?")
        .pluck()
        .get(printer.id),
    ).toBe(JSON.stringify(SETTINGS));
  });

  it("refuses a name that differs only in case", async () => {
    const printers = await repo();
    const input = { driverType: "simulated", settings: SETTINGS, now: 1 };
    printers.create({ name: "Prusa MK4", ...input });

    expect(() => printers.create({ name: "PRUSA mk4", ...input })).toThrow(
      expect.objectContaining({
        code: "SQLITE_CONSTRAINT_UNIQUE",
        message: "UNIQUE constraint failed: printers.name",
      }),
    );
  });
});
