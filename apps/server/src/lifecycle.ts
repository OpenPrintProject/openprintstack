// SPDX-FileCopyrightText: 2026 Open Print Stack contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { Logger } from "./logger.ts";

// How the process ends: on SIGINT (Ctrl-C) or SIGTERM it shuts down in order
// and exits 0; a shutdown that fails or takes too long exits 1, and so does a
// second signal, at once. A bug that escapes every handler is logged and
// exits 1 straight away, without trying to shut down.

/** How long a shutdown may take before the process exits anyway. */
export const SHUTDOWN_TIMEOUT_MS = 10_000;

/** The process events these listen to. `process` by default. */
export type ProcessEvents = {
  on(
    event: "SIGINT" | "SIGTERM",
    listener: (signal: NodeJS.Signals) => void,
  ): unknown;
  on(event: "uncaughtException", listener: (error: Error) => void): unknown;
  on(event: "unhandledRejection", listener: (reason: unknown) => void): unknown;
};

export type LifecycleOptions = {
  logger: Logger;
  events?: ProcessEvents;
  /** `process.exit` by default. */
  exit?: (code: number) => void;
};

export function stopOnSignals(
  options: LifecycleOptions & {
    stop: () => Promise<void>;
    timeoutMs?: number;
  },
): void {
  const log = options.logger.child({ component: "process" });
  const events: ProcessEvents = options.events ?? process;
  const exit = options.exit ?? ((code: number) => process.exit(code));
  const timeoutMs = options.timeoutMs ?? SHUTDOWN_TIMEOUT_MS;
  let stopping = false;

  const onSignal = (signal: NodeJS.Signals) => {
    if (stopping) {
      log.warn({ signal }, "A second signal: exiting without finishing");
      exit(1);
      return;
    }
    stopping = true;
    log.info({ signal }, `${signal}: shutting down`);
    const timer = setTimeout(() => {
      log.error({ timeoutMs }, "Shutting down took too long; exiting anyway");
      exit(1);
    }, timeoutMs);
    options.stop().then(
      () => {
        clearTimeout(timer);
        exit(0);
      },
      (error: unknown) => {
        clearTimeout(timer);
        log.fatal({ err: error }, "Shutting down failed");
        exit(1);
      },
    );
  };
  events.on("SIGINT", onSignal);
  events.on("SIGTERM", onSignal);
}

/**
 * Logs an uncaught exception or unhandled rejection as fatal and exits 1. The
 * process may be in a broken state, so it doesn't try to shut down. SQLite's
 * WAL keeps the database intact; events queued in the current tick are lost.
 */
export function exitOnCrash(options: LifecycleOptions): void {
  const log = options.logger.child({ component: "process" });
  const events: ProcessEvents = options.events ?? process;
  const exit = options.exit ?? ((code: number) => process.exit(code));
  events.on("uncaughtException", (error) => {
    log.fatal({ err: error }, "An uncaught exception; exiting");
    exit(1);
  });
  events.on("unhandledRejection", (reason) => {
    log.fatal({ err: reason }, "An unhandled promise rejection; exiting");
    exit(1);
  });
}
