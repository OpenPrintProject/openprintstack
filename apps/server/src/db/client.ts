// SPDX-FileCopyrightText: 2026 Open Print Stack contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import Database from "better-sqlite3";
import {
  type BetterSQLite3Database,
  drizzle,
} from "drizzle-orm/better-sqlite3";

/** The Drizzle database. `$client` is the better-sqlite3 connection. */
export type Db = BetterSQLite3Database & { $client: Database.Database };

/**
 * Opens (or creates) the database file and applies the connection settings.
 * The server keeps this one connection for its whole life; close it with
 * `db.$client.close()`.
 */
export function openDatabase(file: string): Db {
  const sqlite = new Database(file);
  try {
    configureConnection(sqlite);
  } catch (error) {
    sqlite.close();
    throw error;
  }
  return drizzle({ client: sqlite });
}

/**
 * Applies the plan's connection settings. better-sqlite3 13 already defaults
 * to all but WAL, but they're set here anyway so they don't depend on how it
 * was built.
 */
export function configureConnection(sqlite: Database.Database): void {
  // WAL lets readers carry on while a write is in progress. It's a property
  // of the file, so it can fail, e.g. on some network drives.
  const journalMode: unknown = sqlite.pragma("journal_mode = WAL", {
    simple: true,
  });
  if (journalMode !== "wal") {
    throw new Error(
      `Couldn't switch ${sqlite.name} to WAL mode (it's in ${String(journalMode)} mode).`,
    );
  }
  // Safe from corruption in WAL mode; a power cut may lose the last commits.
  sqlite.pragma("synchronous = NORMAL");
  // SQLite ignores foreign keys unless each connection turns them on.
  sqlite.pragma("foreign_keys = ON");
  // Wait up to 5 s for another connection's lock instead of failing at once.
  sqlite.pragma("busy_timeout = 5000");
}
