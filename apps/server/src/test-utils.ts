// SPDX-FileCopyrightText: 2026 Open Print Stack contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Writable } from "node:stream";

import pino from "pino";
import { onTestFinished } from "vitest";

import { type Db, openDatabase } from "./db/client.ts";
import { migrateDatabase } from "./db/migrate.ts";

// Helpers for the tests. Not used by the server itself.

/** A fresh temporary folder, removed when the test finishes. */
export async function tempDir(): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "ops-server-test-"));
  onTestFinished(() => rm(dir, { recursive: true, force: true }));
  return dir;
}

export const silentLogger = pino({ level: "silent" });

/**
 * A migrated database file in a fresh temporary folder, opened the way the
 * server opens it. Closed and removed when the test finishes.
 */
export async function testDatabase(): Promise<Db> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "ops-server-test-"));
  const db = openDatabase(path.join(dir, "ops.sqlite"));
  onTestFinished(async () => {
    db.$client.close();
    await rm(dir, { recursive: true, force: true });
  });
  migrateDatabase(db, silentLogger);
  return db;
}

/**
 * A log destination that keeps everything written to it. It's a real
 * Writable, because pino-pretty needs one.
 */
export function captureLines(): Writable & { readonly lines: string[] } {
  const lines: string[] = [];
  const stream = new Writable({
    write(chunk: Buffer | string, _encoding, callback) {
      lines.push(chunk.toString());
      callback();
    },
  });
  return Object.assign(stream, { lines });
}

/** Every captured line, parsed as JSON. */
export function jsonLines(
  capture: ReturnType<typeof captureLines>,
): Record<string, unknown>[] {
  return capture.lines.map(
    (line) => JSON.parse(line) as Record<string, unknown>,
  );
}
