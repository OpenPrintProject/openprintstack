// SPDX-FileCopyrightText: 2026 Open Print Stack contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { isIPv6 } from "node:net";
import path from "node:path";

import envPaths from "env-paths";
import { z } from "zod";

// The server's settings, read once at startup from OPS_* environment
// variables. Everything else reads the parsed Config, never process.env.

export const RuntimeEnv = z.enum(["development", "test", "production"], {
  error: "must be development, test or production",
});

export type RuntimeEnv = z.infer<typeof RuntimeEnv>;

export const LogLevel = z.enum(
  ["silent", "fatal", "error", "warn", "info", "debug", "trace"],
  { error: "must be silent, fatal, error, warn, info, debug or trace" },
);

export type LogLevel = z.infer<typeof LogLevel>;

export type Config = {
  /**
   * Development pretty-prints the logs. Development and test also turn on
   * extra runtime checks, such as Zod-checking every event.
   */
  readonly env: RuntimeEnv;
  readonly host: string;
  /** 0 means any free port, which the server logs once it's listening. */
  readonly port: number;
  /**
   * Host names the server answers to besides localhost, 127.0.0.1, [::1] and
   * `host`, normalised as `URL.hostname` gives them (lowercase, IPv6 in
   * brackets). Requests with any other Host header are refused.
   */
  readonly allowedHosts: readonly string[];
  /** An absolute path. */
  readonly dataDir: string;
  readonly logLevel: LogLevel;
  readonly telemetry: {
    /** Telemetry is written at most this often per printer; 0 writes every update. */
    readonly sampleIntervalMs: number;
    /** Telemetry older than this is pruned. */
    readonly retentionDays: number;
  };
};

/**
 * Where data lives when OPS_DATA_DIR isn't set. On macOS that's
 * `~/Library/Application Support/open-print-stack`, and on Windows
 * `%LOCALAPPDATA%\open-print-stack`.
 */
export function defaultDataDir(): string {
  const { data } = envPaths("open-print-stack", { suffix: "" });
  // On Windows env-paths adds a Data folder, to sit beside Config, Cache and
  // Log folders that the server doesn't use.
  return process.platform === "win32" ? path.dirname(data) : data;
}

/**
 * A host name or IP address as `URL.hostname` gives it: lowercase, IPv6 in
 * brackets. Undefined if `value` isn't a bare host (a port, path, scheme or
 * user makes it undefined too).
 */
export function normalizeHostName(value: string): string | undefined {
  const host = isIPv6(value) ? `[${value}]` : value;
  let url: URL;
  try {
    url = new URL(`http://${host}/`);
  } catch {
    return undefined;
  }
  const bare =
    url.port === "" &&
    url.username === "" &&
    url.password === "" &&
    url.pathname === "/" &&
    url.search === "" &&
    url.hash === "" &&
    url.host === url.hostname &&
    // e.g. "a/b" parses, with the path /b.
    !/[/?#@\\\s]/.test(value) &&
    // DNS names (after punycode) and IP addresses only; URL also takes "*".
    /^(?:[a-z0-9_-]+(?:\.[a-z0-9_-]+)*\.?|\[[0-9a-f:.]+\])$/.test(url.hostname);
  return bare ? url.hostname : undefined;
}

const hostList = z.string().transform((value, ctx) => {
  const hosts: string[] = [];
  for (const item of value.split(",")) {
    const entry = item.trim();
    if (entry === "") continue;
    const host = normalizeHostName(entry);
    if (host === undefined) {
      ctx.issues.push({
        code: "custom",
        message:
          "must be a comma-separated list of host names without ports, such as printers.local,192.168.1.20",
        input: value,
      });
      return z.NEVER;
    }
    hosts.push(host);
  }
  return [...new Set(hosts)];
});

/** Digits only, so " 7337", "7e3", "0x1CA9" and "7337.5" are refused. */
function wholeNumber(min: number, max: number) {
  const error = `must be a whole number from ${min} to ${max}`;
  return z
    .string()
    .regex(/^[0-9]+$/, { error })
    .transform(Number)
    .pipe(z.int({ error }).min(min, { error }).max(max, { error }));
}

const variables = {
  OPS_ENV: RuntimeEnv.default("production"),
  OPS_HOST: z
    .string()
    .regex(/^\S+$/, { error: "must not contain spaces" })
    .default("127.0.0.1"),
  // 0 lets the system pick any free port; the server logs which.
  OPS_PORT: wholeNumber(0, 65_535).default(7337),
  OPS_ALLOWED_HOSTS: hostList.optional(),
  OPS_DATA_DIR: z
    .string()
    .refine((value) => !value.startsWith("~"), {
      error:
        "must not start with ~, which isn't expanded here; use an absolute path",
    })
    .optional(),
  OPS_LOG_LEVEL: LogLevel.default("info"),
  OPS_TELEMETRY_SAMPLE_INTERVAL_MS: wholeNumber(0, 3_600_000).default(5000),
  OPS_TELEMETRY_RETENTION_DAYS: wholeNumber(1, 3650).default(7),
};

type VariableName = keyof typeof variables;

/** Every variable the server reads. */
export const CONFIG_VARIABLES = Object.keys(variables) as VariableName[];

const Variables = z.object(variables);

/**
 * Thrown by `loadConfig`, listing every problem at once. None of the variables
 * are secret, so the values given are shown.
 */
export class ConfigError extends Error {
  readonly problems: readonly string[];

  constructor(problems: readonly string[]) {
    super(
      ["Invalid configuration:", ...problems.map((p) => `  ${p}`)].join("\n"),
    );
    this.name = "ConfigError";
    this.problems = problems;
  }
}

export type LoadConfigOptions = {
  /** What a relative OPS_DATA_DIR is resolved against. */
  cwd?: string;
};

/**
 * Reads the config from OPS_* variables. A variable set to an empty string
 * counts as unset. Any problem, including an OPS_* variable the server doesn't
 * know, throws a `ConfigError` that lists them all.
 */
export function loadConfig(
  env: Readonly<Record<string, string | undefined>> = process.env,
  options: LoadConfigOptions = {},
): Config {
  const given: Record<string, string> = {};
  const problems: { name: string; message: string }[] = [];

  for (const [name, value] of Object.entries(env)) {
    if (!name.startsWith("OPS_") || value === undefined || value === "") {
      continue;
    }
    if (Object.hasOwn(variables, name)) {
      given[name] = value;
    } else {
      const suggestion = closestVariable(name);
      problems.push({
        name,
        message: `${name} isn't a known setting${suggestion ? ` (did you mean ${suggestion}?)` : ""}`,
      });
    }
  }

  const result = Variables.safeParse(given);
  if (!result.success) {
    const reported = new Set<PropertyKey>();
    for (const issue of result.error.issues) {
      const name = issue.path[0];
      if (typeof name !== "string" || reported.has(name)) continue;
      reported.add(name);
      problems.push({
        name,
        message: `${name} ${issue.message} (got ${JSON.stringify(given[name])})`,
      });
    }
  }

  if (problems.length > 0 || !result.success) {
    throw new ConfigError(
      problems
        .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
        .map((p) => p.message),
    );
  }

  const vars = result.data;
  return Object.freeze({
    env: vars.OPS_ENV,
    host: vars.OPS_HOST,
    port: vars.OPS_PORT,
    allowedHosts: Object.freeze(vars.OPS_ALLOWED_HOSTS ?? []),
    dataDir: path.resolve(
      options.cwd ?? process.cwd(),
      vars.OPS_DATA_DIR ?? defaultDataDir(),
    ),
    logLevel: vars.OPS_LOG_LEVEL,
    telemetry: Object.freeze({
      sampleIntervalMs: vars.OPS_TELEMETRY_SAMPLE_INTERVAL_MS,
      retentionDays: vars.OPS_TELEMETRY_RETENTION_DAYS,
    }),
  });
}

/**
 * The known variable within 2 edits of `name`, if there is one: enough for
 * OPS_PROT or OPS_LOGLEVEL, without suggesting OPS_ENV for OPS_FOO.
 */
function closestVariable(name: string): VariableName | undefined {
  let best: VariableName | undefined;
  let bestDistance = 3;
  for (const known of CONFIG_VARIABLES) {
    const distance = editDistance(name, known);
    if (distance < bestDistance) {
      best = known;
      bestDistance = distance;
    }
  }
  return best;
}

/**
 * Levenshtein distance: the fewest single-character insertions, deletions or
 * substitutions that turn `a` into `b`.
 */
function editDistance(a: string, b: string): number {
  let previous = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const current = [i];
    for (let j = 1; j <= b.length; j++) {
      const substitution = a[i - 1] === b[j - 1] ? 0 : 1;
      current[j] = Math.min(
        previous[j]! + 1,
        current[j - 1]! + 1,
        previous[j - 1]! + substitution,
      );
    }
    previous = current;
  }
  return previous[b.length]!;
}
