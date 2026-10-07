// SPDX-FileCopyrightText: 2026 Open Print Stack contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  ApiError,
  type Camera,
  NewPassword,
  normalizePassword,
  OpsEvent,
  type OpsEventOf,
  type PrinterFile,
  type PrinterSnapshot,
  reducePrinterState,
  SessionUser,
  Topic,
  Username,
  type WsClientMessage,
} from "@openprintstack/protocol";
import {
  BOOT_ID,
  capabilitiesFixture,
  eventFixtures,
  eventId,
  TS,
  USER_ID,
} from "@openprintstack/protocol/fixtures";
import { z } from "zod";

import type { components } from "../api/schema.gen.ts";
import { FakeSockets, type FakeWebSocket } from "./fake-socket.ts";
import { SIMULATED_DEFAULTS, SIMULATED_DRIVER_TYPE } from "./fixtures.ts";

// The server, as the app's tests need it: users, one session, the auth
// routes with the real server's codes and messages, and a WebSocket hub that
// says hello only with a session (a refused upgrade otherwise) and answers
// subscribe and ping. Socket answers come in a later task, as over a real
// network, never inside the page's send().
//
// The printers' routes record each request and answer as the server does
// when all goes well: driver types, add, config, rename and settings, delete,
// files, cameras, uploads, commands and the simulator's. A test that wants
// the server to refuse something sets an override; the server's own checks
// are tested in the server. `publish` plays the printer: it sends an event to
// every topic the page has subscribed that it belongs on, as the hub does.

export type DriverType = components["schemas"]["DriverType"];

/** The events about one printer. */
export type PrinterEventType = Extract<OpsEvent, { printerId: string }>["type"];
export type PrinterConfig = components["schemas"]["PrinterConfig"];

export type FakeUser = SessionUser & { password: string };

export const ROB: FakeUser = {
  id: USER_ID,
  username: "rob",
  password: "correct horse battery",
};

const CONNECTING = 0;
const OPEN = 1;

export class FakeServer {
  readonly sockets = new FakeSockets();
  /** Every REST request, in order. */
  readonly requests: { method: string; path: string; body: unknown }[] = [];
  users: FakeUser[] = [];
  /** Who the page's session belongs to, if it has one. */
  session: SessionUser | null = null;
  bootId = BOOT_ID;
  printers: PrinterSnapshot[] = [];
  /**
   * "up"; "network": unreachable, so fetch throws; "proxy": down behind
   * Vite's dev proxy, which answers an empty 502.
   */
  mode: "up" | "network" | "proxy" = "up";
  /** Answers sockets by itself. Off: the test plays the hub. */
  autoSockets = true;
  /** Answers for single routes ("GET /api/printers"), instead of the usual. */
  readonly overrides = new Map<string, () => Response>();
  driverTypes: DriverType[] = [SIMULATED_DRIVER_TYPE];
  /** Each printer's stored config, by id. */
  readonly configs = new Map<string, PrinterConfig>();
  /** Each printer's files, by id. */
  readonly files = new Map<string, PrinterFile[]>();
  /** Each printer's cameras, by id. */
  readonly cameras = new Map<string, Camera[]>();
  /** While true, commands wait for `releaseCommands()`. */
  holdCommands = false;
  readonly #held: (() => void)[] = [];
  /** While true, uploads wait for `releaseUploads()`. */
  holdUploads = false;
  readonly #heldUploads: (() => void)[] = [];
  /** The seq of the last event published. */
  #seq = 0;

  /** A server with rob as its admin, logged in or not. */
  static withUser(options: { loggedIn?: boolean } = {}): FakeServer {
    const server = new FakeServer();
    server.users = [ROB];
    if (options.loggedIn === true) server.session = sessionUser(ROB);
    return server;
  }

  /** A printer, with its stored settings (the simulator's defaults). */
  addPrinter(
    snapshot: PrinterSnapshot,
    settings: PrinterConfig["settings"] = { ...SIMULATED_DEFAULTS },
  ): void {
    this.printers.push(snapshot);
    this.configs.set(snapshot.printer.id, {
      id: snapshot.printer.id,
      name: snapshot.printer.name,
      driverType: snapshot.printer.driverType,
      settings,
      settingsVersion: 1,
      createdAt: TS,
      updatedAt: TS,
    });
  }

  /** The printer's snapshot as it is now. */
  printer(printerId: string): PrinterSnapshot {
    const found = this.printers.find((each) => each.printer.id === printerId);
    if (found === undefined) throw new Error(`No printer ${printerId}.`);
    return found;
  }

  /**
   * Publishes an event about a printer, as the bus would: it changes the
   * printer's state, and goes to every open socket's topics it belongs on.
   */
  publish<T extends PrinterEventType>(
    type: T,
    printerId: string,
    payload: OpsEventOf<T>["payload"],
  ): OpsEvent {
    const seq = this.#nextSeq();
    // Checked, as the bus checks events in dev and test.
    const event = OpsEvent.parse({
      ...eventFixtures[type],
      id: eventId(seq),
      seq,
      printerId,
      payload,
    });
    this.printers = this.printers.map((each) =>
      each.printer.id === printerId
        ? { ...each, state: reducePrinterState(each.state, event), seq }
        : each,
    );
    for (const socket of this.sockets.all) {
      if (socket.readyState !== OPEN) continue;
      for (const key of socket.topics()) {
        const topic = Topic.parse(JSON.parse(key));
        if (
          topic.name === "fleet" ||
          (topic.name === "printer" && topic.printerId === printerId)
        ) {
          socket.receive({ type: "event", topic, event });
        }
      }
    }
    return event;
  }

  /** Answers the uploads held while `holdUploads` was true. */
  releaseUploads(): void {
    for (const release of this.#heldUploads.splice(0)) release();
  }

  /** Answers the commands held while `holdCommands` was true. */
  releaseCommands(): void {
    for (const release of this.#held.splice(0)) release();
  }

  /** The requests to one route, e.g. "POST /api/auth/setup". */
  requestsTo(route: string): unknown[] {
    return this.requests
      .filter((request) => `${request.method} ${request.path}` === route)
      .map((request) => request.body);
  }

  readonly fetch = async (
    input: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<Response> => {
    const request = new Request(input, init);
    const path = new URL(request.url).pathname;
    const text = await request.text();
    const type = request.headers.get("content-type");
    // A file's bytes are recorded as they came, with their type.
    const body: unknown =
      text === ""
        ? undefined
        : type === "application/json"
          ? JSON.parse(text)
          : { contentType: type, text };
    this.requests.push({ method: request.method, path, body });
    if (this.mode === "network") throw new TypeError("Failed to fetch");
    if (this.mode === "proxy") {
      return new Response(null, {
        status: 502,
        headers: { "Content-Type": "text/plain", "Content-Length": "0" },
      });
    }
    const route = `${request.method} ${path}`;
    const override = this.overrides.get(route);
    if (override !== undefined) return override();
    switch (route) {
      case "GET /api/auth/me":
        return this.#me();
      case "POST /api/auth/setup":
        return this.#setup(body);
      case "POST /api/auth/login":
        return this.#login(body);
      case "POST /api/auth/logout":
        return this.#logout();
      case "GET /api/driver-types":
        return json(200, { driverTypes: this.driverTypes });
      case "POST /api/printers":
        return this.#add(body);
    }
    return (
      (await this.#printerRoute(request.method, path, body)) ??
      apiError(404, "not_found", `There's nothing at ${route}.`)
    );
  };

  readonly createSocket = (url: string): FakeWebSocket => {
    const socket = this.sockets.create(url);
    socket.onSent = (message) => {
      setTimeout(() => {
        this.#answer(socket, message);
      }, 0);
    };
    if (this.autoSockets) {
      setTimeout(() => {
        this.#upgrade(socket);
      }, 0);
    }
    return socket;
  };

  /** Closes the session's sockets with 4401, as logout and expiry do. */
  endSession(): void {
    this.session = null;
    for (const socket of this.sockets.all) {
      if (socket.readyState === OPEN) {
        socket.serverClose(4401, "The session has ended.");
      }
    }
  }

  async #printerRoute(
    method: string,
    path: string,
    body: unknown,
  ): Promise<Response | undefined> {
    const match = /^\/api\/printers\/([^/]+)(\/.*)?$/.exec(path);
    if (match === null) return undefined;
    const id = decodeURIComponent(match[1] ?? "");
    const rest = match[2] ?? "";
    const config = this.configs.get(id);
    if (config === undefined) {
      return apiError(404, "printer_not_found", `There is no printer ${id}.`);
    }
    if (rest === "/commands" || rest.startsWith("/simulator/")) {
      if (method !== "POST") return undefined;
      if (this.holdCommands) {
        await new Promise<void>((resolve) => this.#held.push(resolve));
      }
      return json(200, commandResult());
    }
    switch (`${method} ${rest}`) {
      case "GET /config":
        return json(200, config);
      case "PATCH ":
        return this.#update(config, body);
      case "DELETE ":
        this.configs.delete(id);
        this.printers = this.printers.filter((each) => each.printer.id !== id);
        return new Response(null, { status: 204 });
      case "GET /files":
        return json(200, { files: this.files.get(id) ?? [] });
      case "GET /cameras":
        return json(200, { cameras: this.cameras.get(id) ?? [] });
    }
    if (method === "PUT" && rest.startsWith("/files/")) {
      if (this.holdUploads) {
        await new Promise<void>((resolve) => this.#heldUploads.push(resolve));
      }
      return json(200, commandResult());
    }
    return undefined;
  }

  #add(body: unknown): Response {
    const { name, driverType, settings } = z
      .object({
        name: z.string(),
        driverType: z.string(),
        settings: z.record(
          z.string(),
          z.union([z.string(), z.number(), z.boolean()]),
        ),
      })
      .parse(body);
    if (this.#nameTaken(name)) return nameTaken();
    const id = `printer-${this.configs.size + 1}`;
    this.addPrinter(
      {
        printer: { id, name, driverType },
        state: {
          status: "idle",
          statusDetail: null,
          error: null,
          telemetry: {
            temperatures: {},
            fans: {},
            speedPercent: null,
            position: null,
            homedAxes: null,
            job: null,
          },
          capabilities: capabilitiesFixture,
          updatedAt: TS,
        },
        seq: this.#seq,
      },
      { ...SIMULATED_DEFAULTS, ...settings },
    );
    return json(201, this.configs.get(id));
  }

  #update(config: PrinterConfig, body: unknown): Response {
    const { name, settings } = z
      .object({
        name: z.string().optional(),
        settings: z
          .record(z.string(), z.union([z.string(), z.number(), z.boolean()]))
          .optional(),
      })
      .parse(body);
    if (name !== undefined && name !== config.name && this.#nameTaken(name)) {
      return nameTaken();
    }
    const updated: PrinterConfig = {
      ...config,
      name: name ?? config.name,
      settings: { ...config.settings, ...settings },
      settingsVersion:
        config.settingsVersion + (settings === undefined ? 0 : 1),
    };
    this.configs.set(config.id, updated);
    this.printers = this.printers.map((each) =>
      each.printer.id === config.id
        ? { ...each, printer: { ...each.printer, name: updated.name } }
        : each,
    );
    return json(200, updated);
  }

  #nameTaken(name: string): boolean {
    return [...this.configs.values()].some(
      (each) => each.name.toLowerCase() === name.toLowerCase(),
    );
  }

  #nextSeq(): number {
    this.#seq =
      Math.max(this.#seq, ...this.printers.map((each) => each.seq)) + 1;
    return this.#seq;
  }

  #me(): Response {
    if (this.session !== null) return json(200, { user: this.session });
    return this.#unauthenticated();
  }

  #setup(body: unknown): Response {
    if (this.users.length > 0) {
      return apiError(409, "setup_done", "Setup has already been done.");
    }
    const parsed = z
      .object({ username: Username, password: NewPassword })
      .safeParse(body);
    if (!parsed.success) {
      return apiError(400, "validation_failed", "The request isn't valid.");
    }
    const user = { id: USER_ID, ...parsed.data };
    this.users = [user];
    this.session = sessionUser(user);
    return json(201, { user: this.session });
  }

  #login(body: unknown): Response {
    const { username, password } = z
      .object({ username: z.string().trim(), password: z.string() })
      .parse(body);
    const user = this.users.find(
      (each) =>
        each.username.toLowerCase() === username.toLowerCase() &&
        normalizePassword(each.password) === normalizePassword(password),
    );
    if (user === undefined) {
      return apiError(
        401,
        "invalid_credentials",
        "The username or password is wrong.",
      );
    }
    this.session = sessionUser(user);
    return json(200, { user: this.session });
  }

  #logout(): Response {
    this.endSession();
    return new Response(null, { status: 204 });
  }

  #unauthenticated(): Response {
    return this.users.length === 0
      ? apiError(
          401,
          "setup_required",
          "No user exists yet: create the admin first.",
        )
      : apiError(401, "unauthenticated", "Log in first.");
  }

  #upgrade(socket: FakeWebSocket): void {
    if (socket.readyState !== CONNECTING) return;
    if (this.mode !== "up" || this.session === null) {
      socket.refuse();
      return;
    }
    socket.accept();
    socket.receive({ type: "hello", bootId: this.bootId, user: this.session });
  }

  #answer(socket: FakeWebSocket, message: WsClientMessage): void {
    if (socket.readyState !== OPEN) return;
    switch (message.type) {
      case "ping":
        socket.receive({ type: "pong" });
        return;
      case "subscribe":
        this.#subscribe(socket, message.topic);
        return;
      case "unsubscribe":
        return;
    }
  }

  #subscribe(socket: FakeWebSocket, topic: Topic): void {
    const seq = Math.max(
      this.#seq,
      ...this.printers.map((printer) => printer.seq),
    );
    switch (topic.name) {
      case "fleet":
        socket.receive({ type: "snapshot", topic, seq, data: this.printers });
        return;
      case "printer": {
        const printer = this.printers.find(
          (each) => each.printer.id === topic.printerId,
        );
        socket.receive(
          printer === undefined
            ? {
                type: "error",
                code: "printer_not_found",
                message: `There is no printer ${topic.printerId}.`,
                topic,
              }
            : { type: "snapshot", topic, seq, data: printer },
        );
        return;
      }
      case "events":
        socket.receive({ type: "snapshot", topic, seq, data: null });
        return;
    }
  }
}

function commandResult(): components["schemas"]["CommandResult"] {
  return {
    commandId: "0199b3a0-1c00-7000-8000-00000000c001",
    ok: true,
    durationMs: 1,
  };
}

function nameTaken(): Response {
  return apiError(409, "name_taken", "Another printer already has that name.");
}

function sessionUser(user: FakeUser): SessionUser {
  return SessionUser.parse({ id: user.id, username: user.username });
}

function json(status: number, body: unknown): Response {
  return Response.json(body, { status });
}

/** An error answer, checked against protocol's ApiError. */
export function apiError(
  status: number,
  code: string,
  message: string,
): Response {
  return json(status, ApiError.parse({ error: { code, message } }));
}
