// SPDX-FileCopyrightText: 2026 Open Print Stack contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

// The whole HTTP app over a real database, bus, state store and printer
// service, for the HTTP tests. Printers use the test driver (or the real
// simulator, as "simulated"). Not used by the server itself.

import type { OpsEvent } from "@openprintstack/protocol";
import { onTestFinished } from "vitest";

import { LoginBackoff, type LoginBackoffOptions } from "../auth/backoff.ts";
import { Passwords, type ScryptParams } from "../auth/passwords.ts";
import { SESSION_COOKIE, SessionService } from "../auth/sessions.ts";
import { EventBus } from "../bus/bus.ts";
import { CommandService } from "../commands/command-service.ts";
import type { Config } from "../config.ts";
import { createRepos } from "../db/repos/index.ts";
import {
  TEST_DRIVER_TYPE,
  TestDrivers,
  testRegistry,
} from "../drivers/test-driver.ts";
import { dataPaths, ensureDataDirs } from "../paths.ts";
import { PrinterService } from "../printers/printer-service.ts";
import { StateStore } from "../state/store.ts";
import { debugLogger, tempDir, testDatabase } from "../test-utils.ts";
import { createApp } from "./app.ts";
import type { AppDeps } from "./context.ts";

/** Cheap scrypt settings, so logins in tests take about a millisecond. */
export const FAST_SCRYPT: ScryptParams = { ln: 4, r: 8, p: 1 };

/** A valid new password: exactly 12 characters. */
export const PASSWORD = "correct hors";

/** When the clock starts. */
export const START = Date.parse("2026-10-06T12:00:00.000Z");

export type TestAppOptions = {
  config?: Partial<Pick<Config, "host" | "allowedHosts">>;
  scrypt?: ScryptParams;
  backoff?: LoginBackoffOptions;
};

export type Call = {
  /** Sent as JSON. */
  json?: unknown;
  /** Sent as it is, e.g. an upload. */
  body?: RequestInit["body"];
  headers?: Record<string, string>;
  /** The session cookie's token. */
  token?: string;
  /**
   * The Origin header. By default unsafe methods send this server's own
   * origin, as a browser on the page would; null leaves it out.
   */
  origin?: string | null;
  /** The Host the request is sent to. "localhost" by default. */
  host?: string;
  /** The client's address, as @hono/node-server reports it. */
  ip?: string;
};

export async function testApp(options: TestAppOptions = {}) {
  const { logger, output } = await debugLogger();
  const db = await testDatabase();
  const repos = createRepos(db);
  const store = new StateStore({
    lookupPrinter: (id) => repos.printers.findById(id),
    logger,
  });
  const bus = new EventBus({ store, logger });
  const events: OpsEvent[] = [];
  bus.subscribe("test", (event) => events.push(event));
  const paths = dataPaths(await tempDir());
  await ensureDataDirs(paths);
  const drivers = new TestDrivers();
  const registry = testRegistry(drivers);
  const printers = new PrinterService({
    printers: repos.printers,
    registry,
    bus,
    store,
    paths,
    logger,
  });
  onTestFinished(async () => {
    await printers.stopAll();
  });
  const commands = new CommandService({ printers, store, bus, paths, logger });
  let time = START;
  const now = () => time;
  const sessions = new SessionService({
    sessions: repos.sessions,
    users: repos.users,
    now,
  });
  const passwords = new Passwords(options.scrypt ?? FAST_SCRYPT);
  const backoff = new LoginBackoff(options.backoff);
  const deps: AppDeps = {
    config: { host: "127.0.0.1", allowedHosts: [], ...options.config },
    logger,
    repos,
    bus,
    store,
    registry,
    printers,
    commands,
    sessions,
    passwords,
    backoff,
    paths,
    now,
  };
  const app = createApp(deps);

  /** Sends a request to the app, as a browser on its own page would. */
  async function call(
    method: string,
    path: string,
    call: Call = {},
  ): Promise<Response> {
    const host = call.host ?? "localhost";
    const headers = new Headers(call.headers);
    const unsafe = !["GET", "HEAD", "OPTIONS"].includes(method);
    const origin =
      call.origin === undefined && unsafe ? `http://${host}` : call.origin;
    if (origin !== undefined && origin !== null) headers.set("origin", origin);
    if (call.token !== undefined) {
      headers.append("cookie", `${SESSION_COOKIE}=${call.token}`);
    }
    let body = call.body;
    if (call.json !== undefined) {
      headers.set("content-type", "application/json");
      body = JSON.stringify(call.json);
    }
    const request = new Request(`http://${host}${path}`, {
      method,
      headers,
      ...(body !== undefined && { body, duplex: "half" }),
    });
    return app.request(
      request,
      undefined,
      call.ip === undefined
        ? undefined
        : { incoming: { socket: { remoteAddress: call.ip } } },
    );
  }

  /** Creates the admin through setup and returns their session's token. */
  async function setupAdmin(username = "rob", password = PASSWORD) {
    const response = await call("POST", "/api/auth/setup", {
      json: { username, password },
    });
    if (response.status !== 201) {
      throw new Error(
        `Setup failed: ${response.status} ${await response.text()}`,
      );
    }
    const { user } = (await response.json()) as {
      user: { id: string; username: string };
    };
    return { token: sessionCookie(response) ?? "", user };
  }

  /** Adds a test-driver printer through the API and returns its id. */
  async function addPrinter(
    token: string,
    name = "Bench",
    settings: Record<string, unknown> = {},
    driverType = TEST_DRIVER_TYPE,
  ) {
    const response = await call("POST", "/api/printers", {
      token,
      json: { name, driverType, settings },
    });
    if (response.status !== 201) {
      throw new Error(
        `Add failed: ${response.status} ${await response.text()}`,
      );
    }
    const { id } = (await response.json()) as { id: string };
    return id;
  }

  return {
    app,
    deps,
    db,
    repos,
    bus,
    store,
    paths,
    printers,
    drivers,
    events,
    logs: output,
    call,
    setupAdmin,
    addPrinter,
    /** Sets the clock that sessions, logins and the backoff read. */
    at: (when: number) => {
      time = when;
    },
    advance: (ms: number) => {
      time += ms;
    },
    /** Each event's type, optionally only those of some types. */
    types: (...only: string[]) =>
      events
        .map((event) => event.type)
        .filter((type) => only.length === 0 || only.includes(type)),
  };
}

export type TestApp = Awaited<ReturnType<typeof testApp>>;

/** The ops_session value a response sets, or undefined. */
export function sessionCookie(response: Response): string | undefined {
  for (const header of response.headers.getSetCookie()) {
    const match = new RegExp(`^${SESSION_COOKIE}=([^;]*)`).exec(header);
    if (match !== null) return match[1];
  }
  return undefined;
}

/** The response's ApiError body. */
export async function apiError(
  response: Response,
): Promise<{ code: string; message: string; details?: unknown }> {
  const body = (await response.json()) as {
    error: { code: string; message: string; details?: unknown };
  };
  return body.error;
}
