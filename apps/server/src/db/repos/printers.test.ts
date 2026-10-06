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

describe("PrintersRepo.list", () => {
  it("lists every printer by name, ignoring case", async () => {
    const printers = await repo();
    const input = { driverType: "simulated", settings: SETTINGS, now: 1 };
    for (const name of ["voron", "Bambu", "prusa", "Anycubic"]) {
      printers.create({ name, ...input });
    }

    expect(printers.list().map((printer) => printer.name)).toEqual([
      "Anycubic",
      "Bambu",
      "prusa",
      "voron",
    ]);
  });

  it("is empty with no printers", async () => {
    expect((await repo()).list()).toEqual([]);
  });
});

describe("PrintersRepo.update", () => {
  async function created() {
    const printers = await repo();
    const printer = printers.create({
      name: "Prusa",
      driverType: "simulated",
      settings: SETTINGS,
      now: 1000,
    });
    return { printers, printer };
  }

  it("renames without touching the settings or their version", async () => {
    const { printers, printer } = await created();

    const updated = printers.update(printer.id, { name: "MK4", now: 2000 });

    expect(updated).toEqual({ ...printer, name: "MK4", updatedAt: 2000 });
    expect(printers.findById(printer.id)).toEqual(updated);
  });

  it("replaces the settings and adds one to their version each time", async () => {
    const { printers, printer } = await created();
    const settings = { printDurationS: 60, cameraEnabled: false };

    printers.update(printer.id, { settings: SETTINGS, now: 2000 });
    const updated = printers.update(printer.id, { settings, now: 3000 });

    expect(updated).toEqual({
      ...printer,
      settings,
      settingsVersion: 3,
      updatedAt: 3000,
    });
  });

  it("changes both at once", async () => {
    const { printers, printer } = await created();
    const settings = { printDurationS: 60 };

    expect(
      printers.update(printer.id, { name: "MK4", settings, now: 2000 }),
    ).toEqual({
      ...printer,
      name: "MK4",
      settings,
      settingsVersion: 2,
      updatedAt: 2000,
    });
  });

  it("lets a printer change the case of its own name", async () => {
    const { printers, printer } = await created();

    expect(printers.update(printer.id, { name: "PRUSA", now: 2 })?.name).toBe(
      "PRUSA",
    );
  });

  it("refuses another printer's name, in any case, and changes nothing", async () => {
    const { printers, printer } = await created();
    printers.create({
      name: "Voron",
      driverType: "simulated",
      settings: {},
      now: 1,
    });

    expect(() =>
      printers.update(printer.id, { name: "VORON", settings: {}, now: 2 }),
    ).toThrow(
      expect.objectContaining({
        code: "SQLITE_CONSTRAINT_UNIQUE",
        message: "UNIQUE constraint failed: printers.name",
      }),
    );
    expect(printers.findById(printer.id)).toEqual(printer);
  });

  it("returns undefined for an unknown printer", async () => {
    const { printers } = await created();

    expect(printers.update("nobody", { name: "x", now: 2 })).toBeUndefined();
  });
});

describe("PrintersRepo.delete", () => {
  it("deletes only that printer and says whether there was one", async () => {
    const printers = await repo();
    const input = { driverType: "simulated", settings: SETTINGS, now: 1 };
    const prusa = printers.create({ name: "Prusa", ...input });
    const voron = printers.create({ name: "Voron", ...input });

    expect(printers.delete(prusa.id)).toBe(true);
    expect(printers.delete(prusa.id)).toBe(false);

    expect(printers.list()).toEqual([voron]);
  });
});
