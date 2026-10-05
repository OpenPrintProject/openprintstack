// SPDX-FileCopyrightText: 2026 Open Print Stack contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  initialPrinterState,
  type OpsEvent,
  type PrinterInfo,
  type PrinterSnapshot,
  reducePrinterState,
} from "@openprintstack/protocol";

import { eventFields } from "../bus/bus.ts";
import type { Logger } from "../logger.ts";

// Every printer's live state, built from the events the bus applies to it.
// It starts empty on boot: a printer appears with its first event (normally
// `status_changed → connecting`) and goes with `printer.removed`.

/**
 * Finds a printer's name and driver type, e.g. from the printers table. Only
 * those two fields are kept, so a whole database row (settings included) is
 * safe to return.
 */
export type PrinterLookup = (
  printerId: string,
) => Pick<PrinterInfo, "name" | "driverType"> | undefined;

export type StateStoreOptions = {
  lookupPrinter: PrinterLookup;
  logger: Logger;
};

export class StateStore {
  readonly #printers = new Map<string, PrinterSnapshot>();
  readonly #lookupPrinter: PrinterLookup;
  readonly #logger: Logger;
  #seq = 0;

  constructor(options: StateStoreOptions) {
    this.#lookupPrinter = options.lookupPrinter;
    this.#logger = options.logger.child({ component: "state" });
  }

  /**
   * The seq of the last event applied, whichever printer it was for (0 before
   * the first). A snapshot read in the same tick is up to date with it.
   */
  get seq(): number {
    return this.#seq;
  }

  /**
   * The printer's snapshot. Snapshots are replaced on every event, never
   * changed in place, and must not be changed by callers.
   */
  get(printerId: string): PrinterSnapshot | undefined {
    return this.#printers.get(printerId);
  }

  /** Every printer's snapshot, in the order the store first saw them. */
  list(): PrinterSnapshot[] {
    return [...this.#printers.values()];
  }

  /**
   * Applies one event. The bus calls this before any subscriber sees the
   * event. The printer's name and driver type are looked up the first time it
   * appears and after `printer.updated`.
   */
  apply(event: OpsEvent): void {
    this.#seq = event.seq;
    const { printerId } = event;
    if (printerId === null) return;

    if (event.type === "printer.removed") {
      this.#printers.delete(printerId);
      return;
    }

    const current = this.#printers.get(printerId);
    const printer =
      current && event.type !== "printer.updated"
        ? current.printer
        : this.#lookup(event, printerId);
    if (!printer) return;

    this.#printers.set(printerId, {
      printer,
      state: reducePrinterState(
        current?.state ?? initialPrinterState(event.ts),
        event,
      ),
      seq: event.seq,
    });
  }

  #lookup(event: OpsEvent, printerId: string): PrinterInfo | undefined {
    const found = this.#lookupPrinter(printerId);
    if (!found) {
      this.#logger.warn(
        eventFields(event),
        "Skipped an event for a printer the state store doesn't know",
      );
      return undefined;
    }
    return { id: printerId, name: found.name, driverType: found.driverType };
  }
}
