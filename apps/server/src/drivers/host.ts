// SPDX-FileCopyrightText: 2026 Open Print Stack contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { isDeepStrictEqual } from "node:util";

import {
  createLoopbackTransport,
  type DriverCall,
  DriverClient,
  DriverError,
  type DriverMessage,
  type DriverMessageOf,
  type DriverModule,
  type DriverProtocolError,
  type DriverResult,
  reduceTelemetry,
  serveDriver,
} from "@openprintstack/driver-sdk";
import {
  Capabilities,
  emptyTelemetry,
  type ErrorInfo,
  type EventSource,
  type PrinterStatus,
  type Telemetry,
} from "@openprintstack/protocol";
import { z } from "zod";

import type { EventBus } from "../bus/bus.ts";
import type { PrinterSettings } from "../db/schema.ts";
import { type Logger, printerLogger } from "../logger.ts";

// One printer's driver, for as long as the server runs. Each start creates the
// driver behind its own transport and client; each stop disconnects, disposes
// and closes it. Everything the driver emits becomes an event here, stamped by
// the bus: drivers never make ids or timestamps.
//
//   status         → printer.status_changed (previous: the last status published)
//   telemetry, job → printer.telemetry, the full merged telemetry
//   job_lifecycle  → printer.job_started or printer.job_ended
//   capabilities   → printer.capabilities_changed, only when they change
//   files_changed  → printer.files_changed
//   alert          → printer.alert
//   log            → the server's log, not the bus (its data merged in)
//
// A message the client can't accept raises a `driver_protocol_error` alert, at
// most one a minute per printer.

/** The longest a driver call may take, except an upload. */
export const CALL_TIMEOUT_MS = 10_000;

/** The longest an upload may take to reach the printer. */
export const UPLOAD_TIMEOUT_MS = 10 * 60_000;

/** A printer raises at most one `driver_protocol_error` alert this often. */
export const PROTOCOL_ALERT_INTERVAL_MS = 60_000;

/** What a driver is started with. */
export type DriverRun = {
  readonly module: DriverModule;
  /** Already parsed by the module's settings schema. */
  readonly settings: PrinterSettings;
  /** The printer's folder, which already exists. */
  readonly storageDir: string;
};

export type DriverStartErrorCode =
  "unknown_driver_type" | "invalid_settings" | "driver_failed";

/** Why a driver couldn't start. It becomes the `offline` status's error. */
export class DriverStartError extends Error {
  override name = "DriverStartError";
  readonly code: DriverStartErrorCode;

  constructor(
    code: DriverStartErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.code = code;
  }
}

/** The calls commands and reads make. Only the host connects and stops. */
export type HostCall = Exclude<
  DriverCall,
  { op: "connect" | "disconnect" | "dispose" }
>;

export type DriverHostOptions = {
  printerId: string;
  bus: Pick<EventBus, "publish">;
  logger: Logger;
  /**
   * Whether the transport checks and copies every message as a worker
   * boundary would. On by default; the server turns it off in production.
   */
  clone?: boolean;
  /** The time in milliseconds, for the alert limit. `Date.now` by default. */
  now?: () => number;
};

/**
 * The fields every driver log line already has. Data keys with these names
 * are dropped: pino would write them as duplicate keys, and whoever parsed
 * the line would read the driver's value.
 */
const LINE_FIELDS = [
  "level",
  "time",
  "pid",
  "msg",
  "component",
  "printerId",
] as const;

const DRIVER: EventSource = { kind: "driver" };
const SYSTEM: EventSource = { kind: "system" };

export const START_FAILED_DETAIL = "The driver couldn't start.";

export class DriverHost {
  readonly printerId: string;
  readonly #bus: Pick<EventBus, "publish">;
  readonly #logger: Logger;
  readonly #driverLogger: Logger;
  readonly #clone: boolean;
  readonly #now: () => number;
  /** The last status published, carried across restarts. */
  #status: PrinterStatus | null = null;
  /** The merged telemetry, as last published. */
  #telemetry: Telemetry = emptyTelemetry();
  /** The capabilities last published, carried across restarts. */
  #capabilities: Capabilities | null = null;
  #client: DriverClient | null = null;
  #starting = false;
  #lastAlertAt: number | null = null;
  #suppressedAlerts = 0;

  constructor(options: DriverHostOptions) {
    this.printerId = options.printerId;
    this.#bus = options.bus;
    this.#logger = options.logger.child({
      component: "driver-host",
      printerId: options.printerId,
    });
    this.#driverLogger = printerLogger(options.logger, options.printerId);
    this.#clone = options.clone ?? true;
    this.#now = options.now ?? (() => Date.now());
  }

  /** The last status published for this printer, or null before the first. */
  get status(): PrinterStatus | null {
    return this.#status;
  }

  /** Whether a driver is running (it may still be offline). */
  get running(): boolean {
    return this.#client !== null;
  }

  /**
   * Publishes `connecting`, then prepares the run (loading the module and
   * parsing the settings), publishes the initial capabilities, creates the
   * driver and waits for its first connect attempt. If any step fails, the
   * driver is released and the printer goes `offline` with the reason as its
   * error; it only throws if a driver is already running or starting.
   */
  async start(prepare: () => Promise<DriverRun>): Promise<void> {
    if (this.#client !== null || this.#starting) {
      throw new Error(`The driver for ${this.printerId} is already running.`);
    }
    this.#starting = true;
    try {
      await this.#start(prepare);
    } finally {
      this.#starting = false;
    }
  }

  async #start(prepare: () => Promise<DriverRun>): Promise<void> {
    this.#publishStatus(
      { type: "status", status: "connecting", detail: null, error: null },
      SYSTEM,
    );

    let run: DriverRun;
    let capabilities: Capabilities;
    try {
      run = await prepare();
      capabilities = initialCapabilities(run);
    } catch (error) {
      this.#failToStart(error);
      return;
    }
    this.#publishCapabilities(capabilities, SYSTEM);

    const transport = createLoopbackTransport({ clone: this.#clone });
    const client = new DriverClient(transport.host, {
      onMessage: (message) => this.#receive(message),
      onProtocolError: (error) => this.#protocolError(error),
    });
    try {
      serveDriver(
        run.module,
        {
          printerId: this.printerId,
          settings: run.settings,
          storageDir: run.storageDir,
        },
        transport.driver,
        {
          onEmitAfterDispose: (message) => {
            this.#logger.warn(
              { messageType: message.type },
              "The driver emitted a message after it was disposed; dropped it",
            );
          },
        },
      );
    } catch (error) {
      client.close();
      this.#failToStart(
        new DriverStartError(
          "driver_failed",
          `The driver couldn't be created: ${messageOf(error)}`,
          { cause: error },
        ),
      );
      return;
    }

    this.#client = client;
    try {
      await client.call(
        { op: "connect", args: {} },
        { timeoutMs: CALL_TIMEOUT_MS },
      );
    } catch (error) {
      // No retry: a settings edit or a server restart tries again.
      this.#client = null;
      await this.#release(client, ["dispose"]);
      this.#failToStart(
        new DriverStartError(
          "driver_failed",
          `The driver couldn't connect: ${messageOf(error)}`,
          { cause: error },
        ),
      );
    }
  }

  /**
   * Disconnects and disposes the driver, then closes its transport, so it
   * sends nothing more. Each step may take up to `CALL_TIMEOUT_MS`; one that
   * fails is logged and the next still runs. Calls fail as `offline` from
   * the moment this starts. Does nothing if no driver is running.
   */
  async stop(): Promise<void> {
    const client = this.#client;
    if (client === null) return;
    this.#client = null;
    await this.#release(client, ["disconnect", "dispose"]);
  }

  /**
   * Calls the running driver. Fails as `offline` if none is running, and as
   * `timeout` after `timeoutMs`.
   */
  call<C extends HostCall>(
    call: C,
    timeoutMs: number,
  ): Promise<DriverResult<C["op"]>> {
    if (this.#client === null) {
      return Promise.reject(
        new DriverError("offline", "The printer's driver isn't running."),
      );
    }
    return this.#client.call(call, { timeoutMs });
  }

  async #release(
    client: DriverClient,
    ops: readonly ("disconnect" | "dispose")[],
  ): Promise<void> {
    for (const op of ops) {
      try {
        await client.call({ op, args: {} }, { timeoutMs: CALL_TIMEOUT_MS });
      } catch (error) {
        this.#logger.warn(
          { err: error, op },
          "A driver call failed while stopping; carried on",
        );
      }
    }
    client.close();
  }

  #failToStart(error: unknown): void {
    const info = startErrorInfo(error);
    this.#logger.error(
      { err: error, code: info.code },
      "The driver couldn't start",
    );
    this.#publishStatus(
      {
        type: "status",
        status: "offline",
        detail: START_FAILED_DETAIL,
        error: info,
      },
      SYSTEM,
    );
  }

  #receive(message: DriverMessage): void {
    // Runs on a microtask, so anything thrown here would crash the server.
    try {
      this.#publishMessage(message);
    } catch (error) {
      this.#logger.error(
        { err: error, messageType: message.type },
        "Couldn't publish a driver message; dropped it",
      );
    }
  }

  #publishMessage(message: DriverMessage): void {
    const printerId = this.printerId;
    switch (message.type) {
      case "status":
        this.#publishStatus(message, DRIVER);
        return;
      case "telemetry":
      case "job": {
        const telemetry = reduceTelemetry(this.#telemetry, message);
        if (telemetry === this.#telemetry) return;
        this.#telemetry = telemetry;
        this.#bus.publish({
          type: "printer.telemetry",
          printerId,
          source: DRIVER,
          payload: { telemetry },
        });
        return;
      }
      case "job_lifecycle": {
        const { event, fileName } = message;
        if (event === "started") {
          this.#bus.publish({
            type: "printer.job_started",
            printerId,
            source: DRIVER,
            payload: { fileName },
          });
        } else {
          this.#bus.publish({
            type: "printer.job_ended",
            printerId,
            source: DRIVER,
            payload: { outcome: event, fileName },
          });
        }
        return;
      }
      case "capabilities":
        this.#publishCapabilities(message.capabilities, DRIVER);
        return;
      case "files_changed":
        this.#bus.publish({
          type: "printer.files_changed",
          printerId,
          source: DRIVER,
          payload: {},
        });
        return;
      case "alert": {
        const { severity, code, message: text } = message;
        this.#bus.publish({
          type: "printer.alert",
          printerId,
          source: DRIVER,
          payload: { severity, code, message: text },
        });
        return;
      }
      case "log": {
        const data = { ...message.data };
        const dropped = LINE_FIELDS.filter((key) => Object.hasOwn(data, key));
        for (const key of dropped) {
          delete data[key];
        }
        this.#driverLogger[message.level](data, message.message);
        if (dropped.length > 0) {
          this.#logger.debug(
            { keys: dropped },
            "Dropped driver log fields that clash with the line's own",
          );
        }
        return;
      }
    }
  }

  #publishStatus(message: DriverMessageOf<"status">, source: EventSource) {
    const previous = this.#status;
    this.#status = message.status;
    // Resets the telemetry when the printer isn't online, as the reducer does.
    this.#telemetry = reduceTelemetry(this.#telemetry, message);
    this.#bus.publish({
      type: "printer.status_changed",
      printerId: this.printerId,
      source,
      payload: {
        previous,
        status: message.status,
        detail: message.detail,
        error: message.error,
      },
    });
  }

  #publishCapabilities(capabilities: Capabilities, source: EventSource) {
    if (isDeepStrictEqual(capabilities, this.#capabilities)) return;
    this.#capabilities = capabilities;
    this.#bus.publish({
      type: "printer.capabilities_changed",
      printerId: this.printerId,
      source,
      payload: { capabilities },
    });
  }

  #protocolError(error: DriverProtocolError): void {
    try {
      // What the driver sent isn't logged: it could be huge (a snapshot).
      this.#logger.warn(
        { problem: error.message },
        "The driver sent a message the server couldn't read",
      );
      const now = this.#now();
      if (
        this.#lastAlertAt !== null &&
        now - this.#lastAlertAt < PROTOCOL_ALERT_INTERVAL_MS
      ) {
        this.#suppressedAlerts += 1;
        return;
      }
      const more = this.#suppressedAlerts;
      this.#lastAlertAt = now;
      this.#suppressedAlerts = 0;
      this.#bus.publish({
        type: "printer.alert",
        printerId: this.printerId,
        source: SYSTEM,
        payload: {
          severity: "error",
          code: "driver_protocol_error",
          message: `The driver sent a message the server couldn't read${
            more > 0 ? `, and ${more} more since the last alert` : ""
          }. The server log has the details.`,
        },
      });
    } catch (failure) {
      this.#logger.error(
        { err: failure },
        "Couldn't raise an alert for a malformed driver message",
      );
    }
  }
}

/** The module's capabilities for these settings, checked like a message. */
function initialCapabilities(run: DriverRun): Capabilities {
  const result = Capabilities.safeParse(
    run.module.initialCapabilities(run.settings),
  );
  if (!result.success) {
    throw new DriverStartError(
      "driver_failed",
      `The driver's initial capabilities are invalid. ${z.prettifyError(result.error)}`,
    );
  }
  return result.data;
}

function startErrorInfo(error: unknown): ErrorInfo {
  return error instanceof DriverStartError
    ? { code: error.code, message: error.message }
    : { code: "driver_failed", message: messageOf(error) };
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
