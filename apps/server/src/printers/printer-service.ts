// SPDX-FileCopyrightText: 2026 Open Print Stack contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { isDeepStrictEqual } from "node:util";

import type { DriverModule, DriverResult } from "@openprintstack/driver-sdk";
import type { PrinterStatus } from "@openprintstack/protocol";
import { SqliteError } from "better-sqlite3";
import { z } from "zod";

import type { EventBus } from "../bus/bus.ts";
import type { Printer, PrintersRepo } from "../db/repos/index.ts";
import type { PrinterSettings } from "../db/schema.ts";
import {
  CALL_TIMEOUT_MS,
  DriverHost,
  type DriverRun,
  DriverStartError,
  type HostCall,
} from "../drivers/host.ts";
import type { DriverRegistry } from "../drivers/registry.ts";
import type { Logger } from "../logger.ts";
import {
  type DataPaths,
  ensurePrinterDir,
  removePrinterDir,
} from "../paths.ts";
import type { StateStore } from "../state/store.ts";

// Printers' lifecycle: their rows, their printer.* events and their drivers.
//
//   boot      every stored printer starts, in parallel
//   add       row → printer.added → start
//   rename    row → printer.updated (no restart)
//   settings  refused during a job; row (version + 1) → printer.updated →
//             stop → start
//   delete    stop → folder removed → row deleted → printer.removed
//
// Each printer's lifecycle steps run one at a time, so a delete can't overlap
// a restart. Starting never throws: a driver that can't run leaves its
// printer `offline` with the reason as its error.

/** A settings edit is refused while the printer is in one of these. */
export const JOB_STATUSES: readonly PrinterStatus[] = [
  "preparing",
  "printing",
  "pausing",
  "paused",
  "cancelling",
];

export type PrinterServiceErrorCode =
  | "printer_not_found"
  | "name_taken"
  | "unknown_driver_type"
  | "invalid_settings"
  | "job_active";

/**
 * Why a printer change was refused. Nothing was written or published. PR 8
 * maps the code to an HTTP status; `details` holds the settings' issues.
 */
export class PrinterServiceError extends Error {
  override name = "PrinterServiceError";
  readonly code: PrinterServiceErrorCode;
  /** For `invalid_settings`: Zod's issues, for the API error's details. */
  readonly details: unknown;

  constructor(
    code: PrinterServiceErrorCode,
    message: string,
    options?: ErrorOptions & { details?: unknown },
  ) {
    super(message, options);
    this.code = code;
    this.details = options?.details;
  }
}

export type NewPrinterInput = {
  name: string;
  driverType: string;
  /** As the user entered them; defaults are filled in before storing. */
  settings: unknown;
  userId: string;
};

export type PrinterUpdate = {
  name?: string;
  /** As the user entered them, replacing the stored settings. */
  settings?: unknown;
};

export type PrinterServiceOptions = {
  printers: PrintersRepo;
  registry: DriverRegistry;
  bus: Pick<EventBus, "publish">;
  store: Pick<StateStore, "get">;
  paths: DataPaths;
  logger: Logger;
  /** Passed to each driver host. On by default; off in production. */
  clone?: boolean;
  /** The time in milliseconds, for the rows. `Date.now` by default. */
  now?: () => number;
};

type Entry = {
  readonly host: DriverHost;
  /** The end of this printer's lifecycle queue. */
  queue: Promise<void>;
};

export class PrinterService {
  readonly #printers: PrintersRepo;
  readonly #registry: DriverRegistry;
  readonly #bus: Pick<EventBus, "publish">;
  readonly #store: Pick<StateStore, "get">;
  readonly #paths: DataPaths;
  readonly #logger: Logger;
  readonly #clone: boolean;
  readonly #now: () => number;
  readonly #entries = new Map<string, Entry>();

  constructor(options: PrinterServiceOptions) {
    this.#printers = options.printers;
    this.#registry = options.registry;
    this.#bus = options.bus;
    this.#store = options.store;
    this.#paths = options.paths;
    this.#logger = options.logger;
    this.#clone = options.clone ?? true;
    this.#now = options.now ?? (() => Date.now());
  }

  /**
   * Starts every stored printer's driver, in parallel, and resolves once each
   * has made its first connect attempt (or failed to start).
   */
  async startAll(): Promise<void> {
    await Promise.all(
      this.#printers.list().map((printer) => {
        const entry = this.#add(printer.id);
        return this.#enqueue(entry, () => this.#start(entry, printer));
      }),
    );
  }

  /**
   * Stops every driver, in parallel, after any lifecycle step in progress.
   * Their `offline` statuses are published; nothing is published afterwards.
   */
  async stopAll(): Promise<void> {
    await Promise.all(
      [...this.#entries.values()].map((entry) =>
        this.#enqueue(entry, () => entry.host.stop()),
      ),
    );
  }

  /** Whether the printer exists. */
  has(printerId: string): boolean {
    return this.#entries.has(printerId);
  }

  /**
   * Creates the printer and starts its driver, resolving after the driver's
   * first connect attempt. Settings are stored with every default filled in.
   */
  async add(input: NewPrinterInput): Promise<Printer> {
    const module = await this.#module(input.driverType);
    const settings = parseSettings(module, input.settings);
    const printer = this.#write(() =>
      this.#printers.create({
        name: input.name,
        driverType: input.driverType,
        settings,
        now: this.#now(),
      }),
    );
    const entry = this.#add(printer.id);
    this.#bus.publish({
      type: "printer.added",
      printerId: printer.id,
      source: { kind: "user", userId: input.userId },
      payload: { name: printer.name, driverType: printer.driverType },
    });
    await this.#enqueue(entry, () => this.#start(entry, printer));
    return printer;
  }

  /**
   * Renames the printer and/or replaces its settings. A rename applies at
   * once. New settings restart the driver, and are refused while a job is
   * active. Settings equal to the stored ones (after parsing) aren't a change.
   * Resolves with the row, after any restart's first connect attempt.
   */
  async update(
    printerId: string,
    update: PrinterUpdate,
    userId: string,
  ): Promise<Printer> {
    const entry = this.#entry(printerId);
    return await this.#enqueue(entry, async () => {
      const printer = this.#find(printerId);
      const changes: { name?: string; settings?: PrinterSettings } = {};
      if (update.name !== undefined && update.name !== printer.name) {
        changes.name = update.name;
      }
      if (update.settings !== undefined) {
        const module = await this.#module(printer.driverType);
        const settings = parseSettings(module, update.settings);
        const stored = module.settingsSchema.safeParse(printer.settings);
        if (!stored.success || !isDeepStrictEqual(settings, stored.data)) {
          this.#refuseDuringJob(printerId);
          changes.settings = settings;
        }
      }
      const changedFields = (["name", "settings"] as const).filter(
        (field) => changes[field] !== undefined,
      );
      if (changedFields.length === 0) return printer;

      const updated = this.#write(() =>
        this.#printers.update(printerId, { ...changes, now: this.#now() }),
      );
      if (updated === undefined) {
        throw notFound(printerId);
      }
      this.#bus.publish({
        type: "printer.updated",
        printerId,
        source: { kind: "user", userId },
        payload: { changedFields },
      });
      if (changes.settings !== undefined) {
        await entry.host.stop();
        await this.#start(entry, updated);
      }
      return updated;
    });
  }

  /**
   * Stops the driver, deletes the printer's folder and row, then publishes
   * `printer.removed`. Works in any status, a job included.
   */
  async remove(printerId: string, userId: string): Promise<void> {
    const entry = this.#entry(printerId);
    await this.#enqueue(entry, async () => {
      const printer = this.#find(printerId);
      await entry.host.stop();
      await removePrinterDir(this.#paths, printerId);
      this.#printers.delete(printerId);
      this.#entries.delete(printerId);
      this.#bus.publish({
        type: "printer.removed",
        printerId,
        source: { kind: "user", userId },
        payload: { name: printer.name },
      });
    });
  }

  /**
   * Calls the printer's driver with a timeout. Fails as `offline` if its
   * driver isn't running, and with `printer_not_found` if there's no printer.
   */
  call<C extends HostCall>(
    printerId: string,
    call: C,
    timeoutMs: number,
  ): Promise<DriverResult<C["op"]>> {
    const entry = this.#entries.get(printerId);
    if (entry === undefined) {
      return Promise.reject(notFound(printerId));
    }
    return entry.host.call(call, timeoutMs);
  }

  /** The printer's files, from its driver. No event is published. */
  listFiles(printerId: string): Promise<DriverResult<"listFiles">> {
    return this.call(printerId, { op: "listFiles", args: {} }, CALL_TIMEOUT_MS);
  }

  /** The printer's cameras, from its driver. No event is published. */
  listCameras(printerId: string): Promise<DriverResult<"listCameras">> {
    return this.call(
      printerId,
      { op: "listCameras", args: {} },
      CALL_TIMEOUT_MS,
    );
  }

  /** A snapshot from one of the printer's cameras. No event is published. */
  getSnapshot(
    printerId: string,
    cameraId: string,
  ): Promise<DriverResult<"getSnapshot">> {
    return this.call(
      printerId,
      { op: "getSnapshot", args: { cameraId } },
      CALL_TIMEOUT_MS,
    );
  }

  #add(printerId: string): Entry {
    if (this.#entries.has(printerId)) {
      throw new Error(`Printer ${printerId} has already started.`);
    }
    const entry: Entry = {
      host: new DriverHost({
        printerId,
        bus: this.#bus,
        logger: this.#logger,
        clone: this.#clone,
      }),
      queue: Promise.resolve(),
    };
    this.#entries.set(printerId, entry);
    return entry;
  }

  #entry(printerId: string): Entry {
    const entry = this.#entries.get(printerId);
    if (entry === undefined) {
      throw notFound(printerId);
    }
    return entry;
  }

  /** The printer's row, or `printer_not_found` if it was deleted meanwhile. */
  #find(printerId: string): Printer {
    const printer = this.#entries.has(printerId)
      ? this.#printers.findById(printerId)
      : undefined;
    if (printer === undefined) {
      throw notFound(printerId);
    }
    return printer;
  }

  /** Runs `step` after the printer's earlier lifecycle steps. */
  #enqueue<T>(entry: Entry, step: () => Promise<T>): Promise<T> {
    const result = entry.queue.then(step);
    entry.queue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  async #module(driverType: string): Promise<DriverModule> {
    if (!this.#registry.has(driverType)) {
      throw new PrinterServiceError(
        "unknown_driver_type",
        `There is no driver type "${driverType}".`,
      );
    }
    return this.#registry.load(driverType);
  }

  #refuseDuringJob(printerId: string): void {
    const status = this.#store.get(printerId)?.state.status;
    if (status !== undefined && JOB_STATUSES.includes(status)) {
      throw new PrinterServiceError(
        "job_active",
        `The settings can't change while the printer is ${status}.`,
      );
    }
  }

  /** Runs a repo write, turning a duplicate name into `name_taken`. */
  #write<T>(write: () => T): T {
    try {
      return write();
    } catch (error) {
      if (
        error instanceof SqliteError &&
        error.code === "SQLITE_CONSTRAINT_UNIQUE" &&
        error.message.includes("printers.name")
      ) {
        throw new PrinterServiceError(
          "name_taken",
          "Another printer already has that name.",
          { cause: error },
        );
      }
      throw error;
    }
  }

  /**
   * Starts the printer's driver from its row. A driver that can't run leaves
   * the printer offline; this doesn't throw for it.
   */
  #start(entry: Entry, printer: Printer): Promise<void> {
    return entry.host.start(async (): Promise<DriverRun> => {
      if (!this.#registry.has(printer.driverType)) {
        throw new DriverStartError(
          "unknown_driver_type",
          `There is no driver type "${printer.driverType}".`,
        );
      }
      const module = await this.#registry.load(printer.driverType);
      const settings = module.settingsSchema.safeParse(printer.settings);
      if (!settings.success) {
        throw new DriverStartError(
          "invalid_settings",
          `The stored settings don't suit the driver. ${z.prettifyError(settings.error)}`,
        );
      }
      return {
        module,
        settings: settings.data as PrinterSettings,
        storageDir: await ensurePrinterDir(this.#paths, printer.id),
      };
    });
  }
}

/** Parses settings for storing, or fails with `invalid_settings`. */
function parseSettings(module: DriverModule, input: unknown): PrinterSettings {
  const result = module.settingsSchema.safeParse(input);
  if (!result.success) {
    throw new PrinterServiceError(
      "invalid_settings",
      `The settings aren't valid. ${z.prettifyError(result.error)}`,
      { details: result.error.issues },
    );
  }
  return result.data as PrinterSettings;
}

function notFound(printerId: string): PrinterServiceError {
  return new PrinterServiceError(
    "printer_not_found",
    `There is no printer ${printerId}.`,
  );
}
