// SPDX-FileCopyrightText: 2026 Open Print Stack contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  CONFIG_VARIABLES,
  type Config,
  ConfigError,
  defaultDataDir,
  loadConfig,
  normalizeHostName,
} from "./config.ts";

const CWD = "/work";

function load(env: Record<string, string | undefined>): Config {
  return loadConfig(env, { cwd: CWD });
}

/** The problems `loadConfig` reports for `env`. */
function problems(env: Record<string, string | undefined>): readonly string[] {
  try {
    load(env);
  } catch (error) {
    if (error instanceof ConfigError) return error.problems;
    throw error;
  }
  throw new Error("Expected a ConfigError");
}

describe("loadConfig", () => {
  it("uses the plan's defaults when nothing is set", () => {
    expect(load({})).toEqual({
      env: "production",
      host: "127.0.0.1",
      port: 7337,
      allowedHosts: [],
      dataDir: defaultDataDir(),
      logLevel: "info",
      telemetry: { sampleIntervalMs: 5000, retentionDays: 7 },
    });
  });

  it("reads every variable", () => {
    expect(
      load({
        OPS_ENV: "development",
        OPS_HOST: "0.0.0.0",
        OPS_PORT: "8080",
        OPS_ALLOWED_HOSTS: "printers.local,192.168.1.20",
        OPS_DATA_DIR: "/srv/ops",
        OPS_LOG_LEVEL: "debug",
        OPS_TELEMETRY_SAMPLE_INTERVAL_MS: "1000",
        OPS_TELEMETRY_RETENTION_DAYS: "30",
      }),
    ).toEqual({
      env: "development",
      host: "0.0.0.0",
      port: 8080,
      allowedHosts: ["printers.local", "192.168.1.20"],
      dataDir: "/srv/ops",
      logLevel: "debug",
      telemetry: { sampleIntervalMs: 1000, retentionDays: 30 },
    });
  });

  it("knows exactly these variables", () => {
    expect(CONFIG_VARIABLES).toEqual([
      "OPS_ENV",
      "OPS_HOST",
      "OPS_PORT",
      "OPS_ALLOWED_HOSTS",
      "OPS_DATA_DIR",
      "OPS_LOG_LEVEL",
      "OPS_TELEMETRY_SAMPLE_INTERVAL_MS",
      "OPS_TELEMETRY_RETENTION_DAYS",
    ]);
  });

  it("treats an empty value as unset", () => {
    const empty = Object.fromEntries(
      CONFIG_VARIABLES.map((name) => [name, ""]),
    );
    expect(load(empty)).toEqual(load({}));
  });

  it("ignores variables without the OPS_ prefix, which is case-sensitive", () => {
    expect(
      load({ PATH: "/bin", HOME: "/home/x", ops_port: "1", OPSPORT: "1" }),
    ).toEqual(load({}));
  });

  it("returns a frozen config", () => {
    const config = load({});
    expect(Object.isFrozen(config)).toBe(true);
    expect(Object.isFrozen(config.telemetry)).toBe(true);
    expect(Object.isFrozen(config.allowedHosts)).toBe(true);
  });

  describe("OPS_ENV", () => {
    it.each(["development", "test", "production"])("accepts %s", (value) => {
      expect(load({ OPS_ENV: value }).env).toBe(value);
    });

    it.each(["prod", "Production", "dev"])("refuses %s", (value) => {
      expect(problems({ OPS_ENV: value })).toEqual([
        `OPS_ENV must be development, test or production (got "${value}")`,
      ]);
    });
  });

  describe("OPS_HOST", () => {
    it.each(["localhost", "::1", "0.0.0.0", "printers.local"])(
      "accepts %s",
      (value) => {
        expect(load({ OPS_HOST: value }).host).toBe(value);
      },
    );

    it.each(["local host", " 127.0.0.1", "\t"])("refuses %j", (value) => {
      expect(problems({ OPS_HOST: value })).toEqual([
        `OPS_HOST must not contain spaces (got ${JSON.stringify(value)})`,
      ]);
    });
  });

  describe("OPS_ALLOWED_HOSTS", () => {
    it("normalises each name, dropping blanks and repeats", () => {
      expect(
        load({
          OPS_ALLOWED_HOSTS:
            " Printers.LOCAL , ,192.168.1.20,::1,printers.local,",
        }).allowedHosts,
      ).toEqual(["printers.local", "192.168.1.20", "[::1]"]);
    });

    it.each([
      "printers.local:7337",
      "http://printers.local",
      "printers.local/x",
      "a b",
      "user@printers.local",
      "printers.local,*",
    ])("refuses %j", (value) => {
      expect(problems({ OPS_ALLOWED_HOSTS: value })).toEqual([
        `OPS_ALLOWED_HOSTS must be a comma-separated list of host names without ports, such as printers.local,192.168.1.20 (got ${JSON.stringify(value)})`,
      ]);
    });
  });

  describe("whole numbers", () => {
    const cases = [
      { name: "OPS_PORT", min: 1, max: 65_535 },
      { name: "OPS_TELEMETRY_SAMPLE_INTERVAL_MS", min: 0, max: 3_600_000 },
      { name: "OPS_TELEMETRY_RETENTION_DAYS", min: 1, max: 3650 },
    ] as const;

    function read(config: Config, name: (typeof cases)[number]["name"]) {
      if (name === "OPS_PORT") return config.port;
      if (name === "OPS_TELEMETRY_SAMPLE_INTERVAL_MS") {
        return config.telemetry.sampleIntervalMs;
      }
      return config.telemetry.retentionDays;
    }

    describe.each(cases)("$name ($min to $max)", ({ name, min, max }) => {
      it("accepts both ends of the range", () => {
        expect(read(load({ [name]: String(min) }), name)).toBe(min);
        expect(read(load({ [name]: String(max) }), name)).toBe(max);
      });

      it("refuses the values just outside it", () => {
        const rule = `${name} must be a whole number from ${min} to ${max}`;
        expect(problems({ [name]: String(max + 1) })).toEqual([
          `${rule} (got "${max + 1}")`,
        ]);
        if (min > 0) {
          expect(problems({ [name]: String(min - 1) })).toEqual([
            `${rule} (got "${min - 1}")`,
          ]);
        }
      });
    });

    it("accepts leading zeros", () => {
      expect(load({ OPS_PORT: "07337" }).port).toBe(7337);
    });

    // z.coerce.number() would accept most of these: " 7337" and "0x1CA9" as
    // numbers, and "" as 0.
    it.each([
      "abc",
      " 7337",
      "7337 ",
      "7e3",
      "0x1CA9",
      "7337.5",
      "7337.0",
      "-1",
      "+1",
      "1_000",
      "99999999999999999999",
    ])("refuses %j with one message", (value) => {
      expect(problems({ OPS_PORT: value })).toEqual([
        `OPS_PORT must be a whole number from 1 to 65535 (got ${JSON.stringify(value)})`,
      ]);
    });
  });

  describe("OPS_DATA_DIR", () => {
    it("keeps an absolute path", () => {
      expect(load({ OPS_DATA_DIR: "/srv/ops data" }).dataDir).toBe(
        "/srv/ops data",
      );
    });

    it("resolves a relative path against the working directory", () => {
      expect(load({ OPS_DATA_DIR: "data/../ops" }).dataDir).toBe("/work/ops");
      expect(loadConfig({ OPS_DATA_DIR: "ops" }).dataDir).toBe(
        path.resolve("ops"),
      );
    });

    it("refuses a leading ~, which nothing expands", () => {
      expect(problems({ OPS_DATA_DIR: "~/ops" })).toEqual([
        `OPS_DATA_DIR must not start with ~, which isn't expanded here; use an absolute path (got "~/ops")`,
      ]);
    });
  });

  describe("OPS_LOG_LEVEL", () => {
    it.each(["silent", "fatal", "error", "warn", "info", "debug", "trace"])(
      "accepts %s",
      (value) => {
        expect(load({ OPS_LOG_LEVEL: value }).logLevel).toBe(value);
      },
    );

    it.each(["INFO", "verbose", "warning"])("refuses %s", (value) => {
      expect(problems({ OPS_LOG_LEVEL: value })).toEqual([
        `OPS_LOG_LEVEL must be silent, fatal, error, warn, info, debug or trace (got "${value}")`,
      ]);
    });
  });

  describe("unknown OPS_ variables", () => {
    it.each([
      ["OPS_PROT", "OPS_PORT"],
      ["OPS_LOGLEVEL", "OPS_LOG_LEVEL"],
      ["OPS_DATADIR", "OPS_DATA_DIR"],
      ["OPS_TELEMETRY_RETENTION_DAY", "OPS_TELEMETRY_RETENTION_DAYS"],
    ])("refuses %s and suggests %s", (name, suggestion) => {
      expect(problems({ [name]: "1" })).toEqual([
        `${name} isn't a known setting (did you mean ${suggestion}?)`,
      ]);
    });

    it.each(["OPS_FOO", "OPS_TOKEN", "OPS_"])(
      "refuses %s without a far-fetched suggestion",
      (name) => {
        expect(problems({ [name]: "1" })).toEqual([
          `${name} isn't a known setting`,
        ]);
      },
    );

    it("ignores an empty unknown variable, like an empty known one", () => {
      expect(load({ OPS_PROT: "" })).toEqual(load({}));
    });
  });

  it("lists every problem in one error, sorted by variable", () => {
    let caught: unknown;
    try {
      load({
        OPS_PORT: "abc",
        OPS_ENV: "prod",
        OPS_PROT: "8080",
        OPS_TELEMETRY_RETENTION_DAYS: "0",
        OPS_HOST: "127.0.0.1",
      });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(ConfigError);
    expect((caught as ConfigError).message).toBe(
      [
        "Invalid configuration:",
        '  OPS_ENV must be development, test or production (got "prod")',
        '  OPS_PORT must be a whole number from 1 to 65535 (got "abc")',
        "  OPS_PROT isn't a known setting (did you mean OPS_PORT?)",
        '  OPS_TELEMETRY_RETENTION_DAYS must be a whole number from 1 to 3650 (got "0")',
      ].join("\n"),
    );
  });
});

describe("normalizeHostName", () => {
  it.each([
    ["localhost", "localhost"],
    ["LOCALHOST", "localhost"],
    ["127.0.0.1", "127.0.0.1"],
    ["::1", "[::1]"],
    ["[::1]", "[::1]"],
    ["0.0.0.0", "0.0.0.0"],
    ["printers.local", "printers.local"],
    ["drucker-österreich.local", "xn--drucker-sterreich-6zb.local"],
  ])("normalises %s to %s", (value, expected) => {
    expect(normalizeHostName(value)).toBe(expected);
  });

  it.each([
    "",
    "localhost:7337",
    "[::1]:7337",
    "http://localhost",
    "local host",
    "a/b",
    "a?b",
    "a#b",
    "a\\b",
    "user@host",
    "*",
  ])("refuses %j", (value) => {
    expect(normalizeHostName(value)).toBeUndefined();
  });
});

describe("defaultDataDir", () => {
  it("has no -nodejs suffix", () => {
    expect(path.basename(defaultDataDir())).toBe("open-print-stack");
  });

  it.runIf(process.platform === "darwin")(
    "is in Application Support on macOS",
    () => {
      expect(defaultDataDir()).toBe(
        path.join(os.homedir(), "Library/Application Support/open-print-stack"),
      );
    },
  );
});
