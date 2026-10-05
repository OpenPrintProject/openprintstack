// SPDX-FileCopyrightText: 2026 Open Print Stack contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { eq } from "drizzle-orm";

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
}
