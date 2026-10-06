// SPDX-FileCopyrightText: 2026 Open Print Stack contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { type Config, ConfigError, loadConfig } from "./config.ts";
import { exitOnCrash, stopOnSignals } from "./lifecycle.ts";
import { createLogger } from "./logger.ts";
import { type RunningServer, startServer } from "./server.ts";

// The server's entry point: `pnpm start` runs `node src/main.ts`, and
// `pnpm dev` runs it under `node --watch` with OPS_ENV=development. Settings
// come from OPS_* variables (config.ts). Exit codes: 0 after a shutdown on
// SIGINT or SIGTERM, 1 for anything else.

let config: Config;
try {
  config = loadConfig();
} catch (error) {
  if (!(error instanceof ConfigError)) throw error;
  // Before there's a logger: the message lists every problem.
  process.stderr.write(`${error.message}\n`);
  process.exit(1);
}

const logger = await createLogger(config);
exitOnCrash({ logger });

let server: RunningServer;
try {
  server = await startServer({ config, logger });
} catch (error) {
  logger.fatal(
    { err: error },
    `The server couldn't start: ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exit(1);
}

stopOnSignals({ logger, stop: () => server.stop() });
