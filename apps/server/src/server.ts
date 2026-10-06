// SPDX-FileCopyrightText: 2026 Open Print Stack contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import type {
  IncomingMessage,
  RequestListener,
  Server,
  ServerResponse,
} from "node:http";
import { type AddressInfo, isIPv6 } from "node:net";

import { createAdaptorServer } from "@hono/node-server";
import { WebSocketServer } from "ws";

import serverPackage from "../package.json" with { type: "json" };
import { LoginBackoff } from "./auth/backoff.ts";
import { Passwords } from "./auth/passwords.ts";
import { SessionService } from "./auth/sessions.ts";
import { EventBus } from "./bus/bus.ts";
import { CommandService } from "./commands/command-service.ts";
import type { Config } from "./config.ts";
import { openDatabase } from "./db/client.ts";
import { migrateDatabase } from "./db/migrate.ts";
import { createRepos } from "./db/repos/index.ts";
import { DriverRegistry } from "./drivers/registry.ts";
import { EventPersistence } from "./events/persistence.ts";
import { Pruner } from "./events/pruner.ts";
import { createApp } from "./http/app.ts";
import type { Logger } from "./logger.ts";
import { dataPaths, ensureDataDirs } from "./paths.ts";
import { PrinterService } from "./printers/printer-service.ts";
import { StateStore } from "./state/store.ts";
import { WsHub } from "./ws/hub.ts";

// Starts and stops the whole server. main.ts runs it with the real config;
// tests run it with a temporary data dir on port 0.
//
//   start  data dirs → database and migrations → state store and bus →
//          persistence and pruner → printers (each driver's first connect
//          attempt) → HTTP and WebSocket listening → system.started
//   stop   system.stopping → no new connections, sockets closed with 1001,
//          requests in flight finished → drivers stopped → pruner stopped →
//          persistence flushed → database closed

export const SERVER_VERSION = serverPackage.version;

/** The largest WebSocket message a client may send; `ws` closes bigger ones with 1009. */
export const WS_MAX_PAYLOAD_BYTES = 64 * 1024;

export type StartServerOptions = {
  config: Config;
  logger: Logger;
  /** The driver types: every built-in one by default. */
  registry?: DriverRegistry;
};

export type RunningServer = {
  /** Where it's listening, e.g. http://127.0.0.1:7337. */
  readonly url: string;
  /** The port it's listening on, which OPS_PORT=0 leaves to the system. */
  readonly port: number;
  readonly bootId: string;
  /**
   * Shuts down in order and resolves once the database is closed. Calling it
   * again returns the same promise.
   */
  stop(): Promise<void>;
};

/** The server couldn't listen, e.g. because the port is taken. */
export class ListenError extends Error {
  override name = "ListenError";
}

export async function startServer(
  options: StartServerOptions,
): Promise<RunningServer> {
  const { config, logger } = options;
  const log = logger.child({ component: "server" });

  const paths = dataPaths(config.dataDir);
  await ensureDataDirs(paths);
  const db = openDatabase(paths.database);
  try {
    migrateDatabase(db, logger);
  } catch (error) {
    db.$client.close();
    throw error;
  }
  const repos = createRepos(db);

  const checks = config.env !== "production";
  const store = new StateStore({
    lookupPrinter: (id) => repos.printers.findById(id),
    logger,
  });
  const bus = new EventBus({ store, logger, validate: checks });
  const persistence = new EventPersistence({
    bus,
    events: repos.events,
    logger,
    sampleIntervalMs: config.telemetry.sampleIntervalMs,
  });
  const pruner = new Pruner({
    repos,
    logger,
    retentionDays: config.telemetry.retentionDays,
  });
  // Boot doesn't wait for a long backlog of old telemetry to be deleted.
  void pruner.start();

  const registry = options.registry ?? new DriverRegistry();
  const printers = new PrinterService({
    printers: repos.printers,
    registry,
    bus,
    store,
    paths,
    logger,
    clone: checks,
  });
  await printers.startAll();
  log.info({ printers: store.list().length }, "Started the printers");

  const sessions = new SessionService({
    sessions: repos.sessions,
    users: repos.users,
  });
  const hub = new WsHub({ bus, store, sessions, logger, validate: checks });
  const app = createApp({
    config,
    logger,
    repos,
    bus,
    store,
    registry,
    printers,
    commands: new CommandService({ printers, store, bus, paths, logger }),
    sessions,
    passwords: new Passwords(),
    backoff: new LoginBackoff(),
    hub,
    paths,
    now: () => Date.now(),
  });
  const server = createHttpServer(app);

  async function shutdown(): Promise<void> {
    log.info("Shutting down");
    bus.publish({
      type: "system.stopping",
      printerId: null,
      source: { kind: "system" },
      payload: {},
    });
    const httpClosed = new Promise<void>((resolve) => {
      // It waits for open connections, sockets included, to end.
      server.close(() => {
        resolve();
      });
    });
    await hub.close();
    await httpClosed;
    await printers.stopAll();
    await pruner.stop();
    persistence.close();
    db.$client.close();
    log.info("Stopped");
  }

  let port: number;
  try {
    port = await listen(server, config.host, config.port);
  } catch (error) {
    await hub.close();
    await printers.stopAll();
    await pruner.stop();
    persistence.close();
    db.$client.close();
    throw error;
  }

  const url = `http://${isIPv6(config.host) ? `[${config.host}]` : config.host}:${port}`;
  bus.publish({
    type: "system.started",
    printerId: null,
    source: { kind: "system" },
    payload: { version: SERVER_VERSION },
  });
  log.info({ url, version: SERVER_VERSION }, `Listening on ${url}`);

  let stopping: Promise<void> | null = null;
  return {
    url,
    port,
    bootId: bus.bootId,
    stop: () => (stopping ??= shutdown()),
  };
}

/**
 * The HTTP server for the app: WebSocket upgrades go to the app too (so its
 * Host check and the /api/ws route see them), with `ws` doing the WebSocket
 * protocol, and `Expect: 100-continue` waits for the body to be read.
 */
export function createHttpServer(app: {
  fetch: Parameters<typeof createAdaptorServer>[0]["fetch"];
}): Server {
  const server = createAdaptorServer({
    fetch: app.fetch,
    websocket: {
      server: new WebSocketServer({
        noServer: true,
        maxPayload: WS_MAX_PAYLOAD_BYTES,
      }),
    },
    // Without createServer options it's always an HTTP/1.1 server.
  }) as Server;
  server.on("checkContinue", continueOnRead(server));
  return server;
}

/** Listens and resolves with the port, or rejects with a ListenError. */
export function listen(
  server: Server,
  host: string,
  port: number,
): Promise<number> {
  return new Promise((resolve, reject) => {
    const onError = (error: NodeJS.ErrnoException) => {
      server.off("listening", onListening);
      reject(listenError(error, host, port));
    };
    const onListening = () => {
      server.off("error", onError);
      resolve((server.address() as AddressInfo).port);
    };
    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(port, host);
  });
}

function listenError(
  error: NodeJS.ErrnoException,
  host: string,
  port: number,
): ListenError {
  const messages: Record<string, string> = {
    EADDRINUSE: `Port ${port} on ${host} is already in use. Stop whatever is using it, or set OPS_PORT to another port.`,
    EACCES: `This user isn't allowed to listen on port ${port} of ${host}. Set OPS_PORT to a port above 1023.`,
    EADDRNOTAVAIL: `${host} isn't an address of this machine. Set OPS_HOST to one that is, such as 127.0.0.1.`,
  };
  return new ListenError(
    messages[error.code ?? ""] ??
      `Couldn't listen on port ${port} of ${host}: ${error.message}`,
    { cause: error },
  );
}

/**
 * Handles `Expect: 100-continue`. Node would answer "100 Continue" straight
 * away, before any check has run, and the client would then send the whole
 * body. Instead it's sent when a route starts reading the body, so a request
 * refused before that (an upload to an offline printer, say) is answered
 * without the body ever being sent. Browsers never send Expect; curl does
 * for bodies over 1 MiB.
 */
function continueOnRead(server: Server): RequestListener {
  return (request: IncomingMessage, response: ServerResponse) => {
    const onListener = (event: string | symbol) => {
      if (event !== "data" && event !== "readable") return;
      request.off("newListener", onListener);
      // After a refusal, @hono/node-server reads (and discards) whatever
      // the client sends anyway; that mustn't ask for the body.
      if (!response.headersSent) response.writeContinue();
    };
    request.on("newListener", onListener);
    server.emit("request", request, response);
  };
}
