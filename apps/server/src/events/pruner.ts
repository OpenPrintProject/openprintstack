// SPDX-FileCopyrightText: 2026 Open Print Stack contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { Repos } from "../db/repos/index.ts";
import type { Logger } from "../logger.ts";

// Deletes telemetry older than the retention period, and expired sessions.
// Every other event is kept for good. It runs when started, then again an
// hour after each run ends.

const DAY_MS = 24 * 60 * 60 * 1000;

export type PrunerOptions = {
  repos: Pick<Repos, "events" | "sessions">;
  logger: Logger;
  /** Telemetry older than this many days is deleted. */
  retentionDays: number;
  /** The time in milliseconds. `Date.now` by default. */
  now?: () => number;
  /**
   * The most telemetry rows deleted per transaction. Between batches the
   * pruner yields to the event loop, so a big backlog doesn't stall the
   * server. 1000 by default.
   */
  batchSize?: number;
  /** The wait between the end of one run and the start of the next. An hour by default. */
  intervalMs?: number;
};

export class Pruner {
  readonly #repos: Pick<Repos, "events" | "sessions">;
  readonly #logger: Logger;
  readonly #retentionMs: number;
  readonly #now: () => number;
  readonly #batchSize: number;
  readonly #intervalMs: number;
  #timer: NodeJS.Timeout | null = null;
  #running: Promise<void> | null = null;
  #started = false;
  #stopping = false;

  constructor(options: PrunerOptions) {
    this.#repos = options.repos;
    this.#logger = options.logger.child({ component: "pruner" });
    this.#retentionMs = options.retentionDays * DAY_MS;
    this.#now = options.now ?? (() => Date.now());
    this.#batchSize = options.batchSize ?? 1000;
    this.#intervalMs = options.intervalMs ?? 60 * 60 * 1000;
  }

  /**
   * Runs now, then an hour after each run ends, until stopped. The returned
   * promise resolves when the first run has finished; it never rejects, as
   * failures are logged.
   */
  start(): Promise<void> {
    if (this.#started) {
      throw new Error("The pruner has already been started.");
    }
    this.#started = true;
    return this.#run();
  }

  /**
   * Cancels the next run. A run in progress stops after its current batch;
   * the returned promise resolves once it has.
   */
  async stop(): Promise<void> {
    this.#stopping = true;
    if (this.#timer) {
      clearTimeout(this.#timer);
      this.#timer = null;
    }
    await this.#running;
  }

  #run(): Promise<void> {
    this.#timer = null;
    const running = this.#prune()
      .catch((error: unknown) => {
        this.#logger.error({ err: error }, "Pruning failed");
      })
      .finally(() => {
        this.#running = null;
        if (!this.#stopping) {
          this.#timer = setTimeout(() => void this.#run(), this.#intervalMs);
          // An hourly chore mustn't keep the process alive.
          this.#timer.unref();
        }
      });
    this.#running = running;
    return running;
  }

  async #prune(): Promise<void> {
    const started = this.#now();
    const sessions = this.#repos.sessions.deleteExpired(started);

    const cutoff = started - this.#retentionMs;
    let telemetry = 0;
    for (;;) {
      const deleted = this.#repos.events.deleteTelemetryBefore(
        cutoff,
        this.#batchSize,
      );
      telemetry += deleted;
      if (deleted < this.#batchSize) break;
      await new Promise((resolve) => setImmediate(resolve));
      if (this.#stopping) break;
    }

    const fields = {
      telemetry,
      sessions,
      cutoff: new Date(cutoff).toISOString(),
    };
    if (telemetry > 0 || sessions > 0) {
      this.#logger.info(fields, "Pruned old telemetry and expired sessions");
    } else {
      this.#logger.debug(fields, "Nothing to prune");
    }
  }
}
