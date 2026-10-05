// SPDX-FileCopyrightText: 2026 Open Print Stack contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { z } from "zod";

import type {
  DriverContext,
  DriverInit,
  DriverModule,
  PrinterDriver,
  SettingsSchema,
} from "./contract.ts";
import { dispatch } from "./dispatch.ts";
import { DriverError } from "./errors.ts";
import type { DriverMessage, LogData, LogLevel } from "./messages.ts";
import type { DriverSideTransport } from "./transport.ts";
import { type DriverResponse, RequestEnvelope } from "./wire.ts";

export interface ServeDriverOptions {
  /**
   * Called with each message the driver emits after `dispose`. They are
   * dropped either way; a well-behaved driver never sends one.
   */
  onEmitAfterDispose?: (message: DriverMessage) => void;
}

export interface DriverEndpoint {
  /**
   * The driver itself, for in-process tests such as the conformance kit. The
   * host only ever talks to it through the transport.
   */
  readonly driver: PrinterDriver;
}

/**
 * The driver's side of the transport. It parses `init.settings` with the
 * module's schema (applying defaults), creates the driver, forwards everything
 * the driver emits, and answers each request through `dispatch`.
 *
 * Once `dispose` has run, emits are dropped and requests fail as `internal`.
 */
export function serveDriver<S extends SettingsSchema>(
  module: DriverModule<S>,
  init: DriverInit<unknown>,
  transport: DriverSideTransport,
  options: ServeDriverOptions = {},
): DriverEndpoint {
  let disposed = false;

  function emit(message: DriverMessage): void {
    if (disposed) {
      options.onEmitAfterDispose?.(message);
      return;
    }
    transport.send({ type: "message", message });
  }

  function logger(level: LogLevel) {
    return (message: string, data?: LogData): void => {
      emit(
        data === undefined
          ? { type: "log", level, message }
          : { type: "log", level, message, data },
      );
    };
  }

  const ctx: DriverContext = {
    emit,
    log: {
      debug: logger("debug"),
      info: logger("info"),
      warn: logger("warn"),
      error: logger("error"),
    },
  };

  const driver = module.create(
    {
      printerId: init.printerId,
      settings: module.settingsSchema.parse(init.settings),
      storageDir: init.storageDir,
    },
    ctx,
  );

  function respond(response: DriverResponse, op: string): void {
    try {
      transport.send(response);
    } catch (error) {
      // The result couldn't be sent, e.g. it holds a Date. Say so instead.
      const reason = error instanceof Error ? ` ${error.message}` : "";
      const failure = new DriverError(
        "internal",
        `The driver's result for "${op}" can't be sent.${reason}`,
        { cause: error },
      );
      transport.send({
        type: "response",
        id: response.id,
        ok: false,
        error: failure.toInfo(),
      });
    }
  }

  async function handle(request: z.infer<typeof RequestEnvelope>) {
    if (disposed) {
      const error = new DriverError("internal", "The driver was disposed.");
      respond(
        { type: "response", id: request.id, ok: false, error: error.toInfo() },
        request.op,
      );
      return;
    }
    try {
      respond(await dispatch(driver, request), request.op);
    } finally {
      if (request.op === "dispose") {
        disposed = true;
      }
    }
  }

  transport.onMessage((raw) => {
    const request = RequestEnvelope.safeParse(raw);
    if (!request.success) {
      // Without a valid id there is nothing to answer.
      ctx.log.error("Ignored a malformed request from the host.", {
        issues: z.prettifyError(request.error),
      });
      return;
    }
    void handle(request.data);
  });

  return { driver };
}
