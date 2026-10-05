// SPDX-FileCopyrightText: 2026 Open Print Stack contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import pino, {
  type DestinationStream,
  type Logger,
  type LoggerOptions,
} from "pino";

import type { Config } from "./config.ts";

export type { Logger };

// One JSON line per entry on stdout, pretty-printed in development:
//   {"level":"info","time":"2026-10-05T17:00:00.000Z","pid":123,"component":"db","msg":"…"}
// Modules log through children that name them: logger.child({ component }).

const SECRET_KEYS = [
  "password",
  "passwordHash",
  "token",
  "cookie",
  "authorization",
  "settings",
];

/**
 * Fields whose values are logged as "[Redacted]". Pino's `*.key` matches
 * exactly one level down and doesn't look inside arrays, so each depth is
 * listed. Printer settings may hold a driver's secrets, such as an API key.
 */
export const REDACT_PATHS: readonly string[] = [
  ...SECRET_KEYS,
  ...SECRET_KEYS.map((key) => `*.${key}`),
  "req.headers.cookie",
  "req.headers.authorization",
  'res.headers["set-cookie"]',
];

/**
 * Creates the server's logger. `destination` defaults to stdout; tests pass
 * their own.
 */
export async function createLogger(
  config: Pick<Config, "env" | "logLevel">,
  destination?: DestinationStream,
): Promise<Logger> {
  const options: LoggerOptions = {
    level: config.logLevel,
    // The hostname adds nothing on a single machine.
    base: { pid: process.pid },
    timestamp: pino.stdTimeFunctions.isoTime,
    formatters: { level: (label) => ({ level: label }) },
    redact: { paths: [...REDACT_PATHS] },
  };
  if (config.env === "development") {
    // A devDependency, so it's only loaded here. It runs in this thread
    // rather than as a worker-thread transport, which bundling breaks.
    const { default: pretty } = await import("pino-pretty");
    return pino(options, pretty({ destination: destination ?? 1, sync: true }));
  }
  return destination ? pino(options, destination) : pino(options);
}

/** The logger for one printer's driver, whose `log` messages PR 7 writes. */
export function printerLogger(logger: Logger, printerId: string): Logger {
  return logger.child({ component: "driver", printerId });
}
