// SPDX-FileCopyrightText: 2026 Open Print Stack contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { cp, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { readMigrationFiles } from "drizzle-orm/migrator";
import { describe, expect, it, onTestFinished } from "vitest";

import { createLogger } from "../logger.ts";
import {
  captureLines,
  jsonLines,
  silentLogger,
  tempDir,
} from "../test-utils.ts";
import { type Db, openDatabase } from "./client.ts";
import {
  DatabaseTooNewError,
  MIGRATIONS_FOLDER,
  migrateDatabase,
} from "./migrate.ts";

async function freshDatabase(): Promise<{ db: Db; file: string; dir: string }> {
  const dir = await tempDir();
  const file = path.join(dir, "ops.sqlite");
  const db = openDatabase(file);
  onTestFinished(() => {
    db.$client.close();
  });
  return { db, file, dir };
}

async function debugLogger() {
  const output = captureLines();
  const logger = await createLogger(
    { env: "production", logLevel: "debug" },
    output,
  );
  return { logger, output };
}

function tables(db: Db): unknown[] {
  return db.$client
    .prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
    )
    .pluck()
    .all();
}

function appliedCount(db: Db): unknown {
  return db.$client
    .prepare("SELECT count(*) FROM __drizzle_migrations")
    .pluck()
    .get();
}

type Journal = {
  entries: {
    idx: number;
    version: string;
    when: number;
    tag: string;
    breakpoints: boolean;
  }[];
};

/**
 * A copy of the committed migrations plus one more, generated `laterMs` after
 * the newest, as if by a later version of the server.
 */
async function withExtraMigration(
  sql: string,
  laterMs = 1000,
): Promise<string> {
  const folder = path.join(await tempDir(), "drizzle");
  await cp(MIGRATIONS_FOLDER, folder, { recursive: true });
  const journalFile = path.join(folder, "meta", "_journal.json");
  const journal = JSON.parse(await readFile(journalFile, "utf8")) as Journal;
  const last = journal.entries.at(-1)!;
  const tag = `${String(last.idx + 1).padStart(4, "0")}_later`;
  journal.entries.push({
    ...last,
    idx: last.idx + 1,
    when: last.when + laterMs,
    tag,
  });
  await writeFile(journalFile, JSON.stringify(journal));
  await writeFile(path.join(folder, `${tag}.sql`), sql);
  return folder;
}

describe("migrateDatabase", () => {
  it("uses the committed drizzle/ folder", () => {
    expect(MIGRATIONS_FOLDER).toBe(
      path.resolve(import.meta.dirname, "../../drizzle"),
    );
    expect(
      readMigrationFiles({ migrationsFolder: MIGRATIONS_FOLDER }),
    ).toHaveLength(1);
  });

  it("creates the plan's four tables on a fresh database", async () => {
    const { db } = await freshDatabase();
    const { logger, output } = await debugLogger();

    migrateDatabase(db, logger);

    expect(tables(db)).toEqual([
      "__drizzle_migrations",
      "events",
      "printers",
      "sessions",
      "users",
    ]);
    expect(appliedCount(db)).toBe(1);
    expect(jsonLines(output)).toMatchObject([
      {
        level: "info",
        component: "db",
        applied: 1,
        msg: "Applied database migrations",
      },
    ]);
  });

  it("does nothing when the database is up to date, even after reopening", async () => {
    const { db, file } = await freshDatabase();
    migrateDatabase(db, (await debugLogger()).logger);
    db.$client.close();
    const reopened = openDatabase(file);
    onTestFinished(() => {
      reopened.$client.close();
    });
    const { logger, output } = await debugLogger();

    migrateDatabase(reopened, logger);
    migrateDatabase(reopened, logger);

    expect(appliedCount(reopened)).toBe(1);
    expect(jsonLines(output)).toMatchObject([
      { level: "debug", component: "db", msg: "Database schema is up to date" },
      { level: "debug", component: "db", msg: "Database schema is up to date" },
    ]);
  });

  it("applies a newer migration on top", async () => {
    const { db } = await freshDatabase();
    migrateDatabase(db, (await debugLogger()).logger);
    const later = await withExtraMigration(
      "CREATE TABLE `later` (`x` integer);",
    );
    const { logger, output } = await debugLogger();

    migrateDatabase(db, logger, later);

    expect(tables(db)).toContain("later");
    expect(appliedCount(db)).toBe(2);
    expect(jsonLines(output)).toMatchObject([{ applied: 1 }]);
  });

  it("refuses a database that a newer server has migrated", async () => {
    const { db, file } = await freshDatabase();
    const later = await withExtraMigration(
      "CREATE TABLE `later` (`x` integer);",
    );
    migrateDatabase(db, (await debugLogger()).logger, later);

    expect(() => migrateDatabase(db, silentLogger)).toThrow(
      DatabaseTooNewError,
    );
    expect(() => migrateDatabase(db, silentLogger)).toThrow(
      `${file} was updated by a newer version of Open Print Stack, so this version can't use it.`,
    );
    expect(appliedCount(db)).toBe(2);
  });

  it("applies nothing if any statement of any migration fails", async () => {
    const { db } = await freshDatabase();
    const broken = await withExtraMigration(
      "CREATE TABLE `later` (`x` integer);\n--> statement-breakpoint\nNOT SQL;",
    );

    expect(() => migrateDatabase(db, silentLogger, broken)).toThrow();
    // Drizzle creates its own table before the transaction starts.
    expect(tables(db)).toEqual(["__drizzle_migrations"]);
    expect(appliedCount(db)).toBe(0);
  });
});
