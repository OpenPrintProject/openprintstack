// SPDX-FileCopyrightText: 2026 Open Print Stack contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { IncomingMessage } from "node:http";

import type { SessionUser } from "@openprintstack/protocol";

import type { LoginBackoff } from "../auth/backoff.ts";
import type { Passwords } from "../auth/passwords.ts";
import type { SessionService } from "../auth/sessions.ts";
import type { EventBus } from "../bus/bus.ts";
import type { CommandService } from "../commands/command-service.ts";
import type { Config } from "../config.ts";
import type { Repos } from "../db/repos/index.ts";
import type { DriverRegistry } from "../drivers/registry.ts";
import type { Logger } from "../logger.ts";
import type { DataPaths } from "../paths.ts";
import type { PrinterService } from "../printers/printer-service.ts";
import type { StateStore } from "../state/store.ts";
import type { WsHub } from "../ws/hub.ts";
import type { WebApp } from "./web.ts";

/** Everything the HTTP app uses. PR 9's main.ts builds these. */
export type AppDeps = {
  readonly config: Pick<Config, "host" | "allowedHosts">;
  readonly logger: Logger;
  readonly repos: Repos;
  readonly bus: Pick<EventBus, "publish">;
  readonly store: Pick<StateStore, "get">;
  readonly registry: DriverRegistry;
  readonly printers: PrinterService;
  readonly commands: CommandService;
  readonly sessions: SessionService;
  readonly passwords: Passwords;
  readonly backoff: LoginBackoff;
  /** Takes over each socket the /api/ws upgrade opens. */
  readonly hub: Pick<WsHub, "open">;
  readonly paths: DataPaths;
  /** What pages (GET outside /api) get: the web app's build, or a note. */
  readonly web: WebApp;
  /** The time in milliseconds, for sessions, logins and rows. */
  readonly now: () => number;
};

/**
 * The Hono environment of every route. Under @hono/node-server, `incoming` is
 * Node's request; `app.request()` in tests may leave it out.
 */
export type AppEnv = {
  Bindings: { incoming?: Pick<IncomingMessage, "socket"> };
  Variables: {
    deps: AppDeps;
    /** Set by `requireSession`; routes that use it see it as defined. */
    user: SessionUser | undefined;
    sessionId: string | undefined;
  };
};

/**
 * The environment of a route behind `requireSession`, which sets the user and
 * session id.
 */
export type SessionEnv = {
  Bindings: AppEnv["Bindings"];
  Variables: Omit<AppEnv["Variables"], "user" | "sessionId"> & {
    user: SessionUser;
    sessionId: string;
  };
};
