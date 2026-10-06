// SPDX-FileCopyrightText: 2026 Open Print Stack contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { asc, eq, sql } from "drizzle-orm";

import { newId } from "../../ids.ts";
import type { Db } from "../client.ts";
import { type PrinterSettings, printers } from "../schema.ts";

export type Printer = typeof printers.$inferSelect;

export type NewPrinter = {
  name: string;
  driverType: string;
  /** Already checked against the driver module's settings schema. */
  settings: PrinterSettings;
  now: number;
};

export type PrinterChanges = {
  name?: string;
  /** Already checked against the driver module's settings schema. */
  settings?: PrinterSettings;
  now: number;
};

export class PrintersRepo {
  readonly #db: Db;

  constructor(db: Db) {
    this.#db = db;
  }

  /**
   * Creates the printer at settings version 1. A name that differs only in
   * case is taken.
   */
  create(input: NewPrinter): Printer {
    return this.#db
      .insert(printers)
      .values({
        id: newId(),
        name: input.name,
        driverType: input.driverType,
        settings: input.settings,
        settingsVersion: 1,
        createdAt: input.now,
        updatedAt: input.now,
      })
      .returning()
      .get();
  }

  findById(id: string): Printer | undefined {
    return this.#db.select().from(printers).where(eq(printers.id, id)).get();
  }

  /** Every printer, by name (ignoring case), then id. */
  list(): Printer[] {
    return this.#db
      .select()
      .from(printers)
      .orderBy(asc(printers.name), asc(printers.id))
      .all();
  }

  /**
   * Changes the name and/or settings, and returns the new row, or undefined
   * if there's no such printer. Passing settings adds one to the settings
   * version, so only pass them when they changed.
   */
  update(id: string, changes: PrinterChanges): Printer | undefined {
    return this.#db
      .update(printers)
      .set({
        ...(changes.name !== undefined && { name: changes.name }),
        ...(changes.settings !== undefined && {
          settings: changes.settings,
          settingsVersion: sql`${printers.settingsVersion} + 1`,
        }),
        updatedAt: changes.now,
      })
      .where(eq(printers.id, id))
      .returning()
      .get();
  }

  /** Deletes the printer. Returns whether there was one. */
  delete(id: string): boolean {
    return (
      this.#db.delete(printers).where(eq(printers.id, id)).run().changes > 0
    );
  }
}
