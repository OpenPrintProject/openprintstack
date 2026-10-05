// SPDX-FileCopyrightText: 2026 Open Print Stack contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from "vitest";

import type { LogLevel, RuntimeEnv } from "./config.ts";
import { UsersRepo } from "./db/repos/users.ts";
import { createLogger, printerLogger, REDACT_PATHS } from "./logger.ts";
import { captureLines, jsonLines, testDatabase } from "./test-utils.ts";

async function capture(
  env: RuntimeEnv = "production",
  level: LogLevel = "info",
) {
  const output = captureLines();
  const logger = await createLogger({ env, logLevel: level }, output);
  return { logger, output };
}

const SECRET = "s3cret-value";

describe("createLogger", () => {
  it("writes one JSON line per entry, with level names, ISO time and pid", async () => {
    const { logger, output } = await capture();

    logger.info({ printers: 2 }, "Started");

    const lines = jsonLines(output);
    expect(lines).toHaveLength(1);
    const { time, ...rest } = lines[0]!;
    expect(rest).toEqual({
      level: "info",
      pid: process.pid,
      printers: 2,
      msg: "Started",
    });
    expect(time).toMatch(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/);
  });

  it("writes JSON in test, like production", async () => {
    const { logger, output } = await capture("test");

    logger.info("Started");

    expect(jsonLines(output)).toHaveLength(1);
  });

  it("filters by level", async () => {
    const { logger, output } = await capture("production", "warn");

    logger.info("dropped");
    logger.warn("kept");
    logger.error("kept too");

    expect(jsonLines(output).map((line) => line.level)).toEqual([
      "warn",
      "error",
    ]);
  });

  it("writes nothing when silent", async () => {
    const { logger, output } = await capture("production", "silent");

    logger.fatal("dropped");

    expect(output.lines).toEqual([]);
  });

  it("pretty-prints in development, still redacting", async () => {
    const { logger, output } = await capture("development");

    logger.info({ user: { name: "rob", password: SECRET } }, "Logged in");

    const text = output.lines.join("");
    expect(text).toMatch(/INFO \(\d+\): Logged in/);
    expect(text).toContain('"password": "[Redacted]"');
    expect(text).not.toContain(SECRET);
    expect(() => JSON.parse(output.lines[0]!) as unknown).toThrow();
  });
});

describe("redaction", () => {
  const keys = [
    "password",
    "passwordHash",
    "token",
    "cookie",
    "authorization",
    "settings",
  ];

  it("lists each key at the top level and one level down, plus HTTP headers", () => {
    expect(REDACT_PATHS).toEqual([
      ...keys,
      ...keys.map((key) => `*.${key}`),
      "req.headers.cookie",
      "req.headers.authorization",
      'res.headers["set-cookie"]',
    ]);
  });

  it.each(keys)("redacts %s at the top level", async (key) => {
    const { logger, output } = await capture();

    logger.info({ [key]: SECRET, other: "kept" }, "msg");

    const [line] = jsonLines(output);
    expect(line?.[key]).toBe("[Redacted]");
    expect(line?.other).toBe("kept");
  });

  it.each(keys)("redacts %s one level down", async (key) => {
    const { logger, output } = await capture();

    logger.info({ thing: { [key]: SECRET, other: "kept" } }, "msg");

    const [line] = jsonLines(output);
    expect(line?.thing).toEqual({ [key]: "[Redacted]", other: "kept" });
  });

  it("redacts a printer's whole settings object", async () => {
    const { logger, output } = await capture();

    logger.info(
      { printer: { name: "Prusa", settings: { apiKey: SECRET } } },
      "Added",
    );

    expect(output.lines.join("")).not.toContain(SECRET);
    expect(jsonLines(output)[0]?.printer).toEqual({
      name: "Prusa",
      settings: "[Redacted]",
    });
  });

  it("redacts request cookies and authorization, and response set-cookie", async () => {
    const { logger, output } = await capture();

    logger.info(
      {
        req: {
          method: "POST",
          headers: { cookie: SECRET, authorization: SECRET, accept: "*/*" },
        },
        res: {
          headers: { "set-cookie": SECRET, "content-type": "text/plain" },
        },
      },
      "Request",
    );

    const [line] = jsonLines(output);
    expect(output.lines.join("")).not.toContain(SECRET);
    expect(line?.req).toEqual({
      method: "POST",
      headers: {
        cookie: "[Redacted]",
        authorization: "[Redacted]",
        accept: "*/*",
      },
    });
    expect(line?.res).toEqual({
      headers: { "set-cookie": "[Redacted]", "content-type": "text/plain" },
    });
  });
});

describe("child loggers", () => {
  it("printerLogger tags lines with the driver component and printer id", async () => {
    const { logger, output } = await capture();

    printerLogger(logger, "printer-1").warn({ code: 7 }, "Reconnecting");

    expect(jsonLines(output)[0]).toMatchObject({
      level: "warn",
      component: "driver",
      printerId: "printer-1",
      code: 7,
      msg: "Reconnecting",
    });
  });

  it("a component child tags its lines", async () => {
    const { logger, output } = await capture();

    logger.child({ component: "db" }).info("Opened");

    expect(jsonLines(output)[0]).toMatchObject({
      component: "db",
      msg: "Opened",
    });
  });
});

describe("database errors", () => {
  const HASH = "$scrypt$ln=17,r=8,p=1$c2FsdA$aGFzaA";

  // Drizzle's async drivers put a query's values into their errors; the
  // better-sqlite3 driver passes SQLite's own error through, which names
  // columns but never values. This fails if a driver change starts leaking.
  it("a failed insert's error carries none of its values, raw or logged", async () => {
    const repo = new UsersRepo(await testDatabase());
    repo.create({ username: "rob", passwordHash: HASH, now: 1 });
    let error: unknown;
    try {
      repo.create({ username: "ROB", passwordHash: HASH, now: 2 });
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(Error);
    const { logger, output } = await capture();

    logger.error({ err: error }, "Setup failed");

    const { message, stack } = error as Error;
    expect([message, stack, JSON.stringify(error)].join("\n")).not.toContain(
      HASH,
    );
    expect(output.lines.join("")).not.toContain(HASH);
    expect(jsonLines(output)[0]?.err).toMatchObject({
      type: "SqliteError",
      message: "UNIQUE constraint failed: users.username",
      code: "SQLITE_CONSTRAINT_UNIQUE",
    });
  });
});
