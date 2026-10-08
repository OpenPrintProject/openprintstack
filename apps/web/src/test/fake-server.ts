// SPDX-FileCopyrightText: 2026 Open Print Stack contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  ApiError,
  type Camera,
  EventCategory,
  EventType,
  matchesTopic,
  NewPassword,
  normalizePassword,
  OpsEvent,
  type OpsEventOf,
  type PrinterCommand,
  type PrinterFile,
  type PrinterSnapshot,
  reducePrinterState,
  SessionUser,
  Topic,
  topicKey,
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
// files, cameras, uploads, commands and the simulator's (a command publishes
// command.requested and command.result, by the session's user, as the
// server's do). As the server does, it never answers a write-only setting's
// value: configs list the stored ones in `secretsSet`, and an edit leaving
// one empty keeps it. A test that wants the server to refuse something sets
// an override; the server's own checks are tested in the server.
//
// `publish` plays the printer, and `publishGlobal` the server: the event is
// stored in the event log and goes to every topic the page has subscribed
// that it belongs on (protocol's matchesTopic, as the hub does), from the
// topic's snapshot on. Published before the page opens, it's history. GET /api/events pages the log as the
// server does: newest first, its filters, `before` cursors and the users map.
// Unlike the server, it stores every telemetry event.

export type DriverType = components["schemas"]["DriverType"];

/** The events about one printer. */
export type PrinterEventType = Extract<OpsEvent, { printerId: string }>["type"];

/** The events about no printer (auth and system). */
export type GlobalEventType = Extract<OpsEvent, { printerId: null }>["type"];

/** What a test can set of a published event's envelope. */
export type Envelope = Partial<
  Pick<OpsEvent, "source" | "correlationId" | "ts">
>;
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
  /** Every REST request, in order; `search` is the query string, without "?". */
  readonly requests: {
    method: string;
    path: string;
    search: string;
    body: unknown;
  }[] = [];
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
  /** These topics' snapshots wait for `releaseSnapshots()`, e.g. "events". */
  readonly holdSnapshots = new Set<Topic["name"]>();
  readonly #heldSnapshots: (() => void)[] = [];
  /** Every event published, oldest first; an event's row id is its index + 1. */
  readonly log: OpsEvent[] = [];
  /** Each socket's topics that have had their snapshot, by topicKey. */
  readonly #topics = new WeakMap<FakeWebSocket, Map<string, Topic>>();
  /** The seq of the last event published. */
  #seq = 0;
  /** Commands run so far, for their ids. */
  #commands = 0;

  /** A server with rob as its admin, logged in or not. */
  static withUser(options: { loggedIn?: boolean } = {}): FakeServer {
    const server = new FakeServer();
    server.users = [ROB];
    if (options.loggedIn === true) server.session = sessionUser(ROB);
    return server;
  }

  /**
   * A printer, with its stored settings (the simulator's defaults) and the
   * secrets it has stored.
   */
  addPrinter(
    snapshot: PrinterSnapshot,
    settings: PrinterConfig["settings"] = { ...SIMULATED_DEFAULTS },
    secretsSet: string[] = [],
  ): void {
    this.printers.push(snapshot);
    this.configs.set(snapshot.printer.id, {
      id: snapshot.printer.id,
      name: snapshot.printer.name,
      driverType: snapshot.printer.driverType,
      settings,
      secretsSet,
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
   * printer's state, is stored, and goes to every open socket's topics it
   * belongs on.
   */
  publish<T extends PrinterEventType>(
    type: T,
    printerId: string,
    payload: OpsEventOf<T>["payload"],
    envelope: Envelope = {},
  ): OpsEventOf<T> {
    const event = this.#event(type, printerId, payload, envelope);
    this.printers = this.printers.map((each) =>
      each.printer.id === printerId
        ? {
            ...each,
            state: reducePrinterState(each.state, event),
            seq: event.seq,
          }
        : each,
    );
    this.#send(event);
    return event as OpsEventOf<T>;
  }

  /** Publishes an event about no printer (auth or system). */
  publishGlobal<T extends GlobalEventType>(
    type: T,
    payload: OpsEventOf<T>["payload"],
    envelope: Envelope = {},
  ): OpsEventOf<T> {
    const event = this.#event(type, null, payload, envelope);
    this.#send(event);
    return event as OpsEventOf<T>;
  }

  /** A new event, stored in the log. */
  #event<T extends EventType>(
    type: T,
    printerId: string | null,
    payload: OpsEventOf<T>["payload"],
    envelope: Envelope,
  ): OpsEvent {
    const seq = this.#nextSeq();
    // Checked, as the bus checks events in dev and test.
    const event = OpsEvent.parse({
      ...eventFixtures[type],
      id: eventId(seq),
      seq,
      bootId: this.bootId,
      printerId,
      payload,
      ...envelope,
    });
    this.log.push(event);
    return event;
  }

  /** Sends an event to every open socket's topics it belongs on. */
  #send(event: OpsEvent): void {
    for (const socket of this.sockets.all) {
      if (socket.readyState !== OPEN) continue;
      for (const topic of this.#topics.get(socket)?.values() ?? []) {
        if (matchesTopic(topic, event)) {
          socket.receive({ type: "event", topic, event });
        }
      }
    }
  }

  /** Sends the snapshots held by `holdSnapshots`, and holds no more. */
  releaseSnapshots(): void {
    this.holdSnapshots.clear();
    for (const release of this.#heldSnapshots.splice(0)) release();
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

  /** The query strings sent to one route, e.g. "GET /api/events". */
  searchesTo(route: string): string[] {
    return this.requests
      .filter((request) => `${request.method} ${request.path}` === route)
      .map((request) => request.search);
  }

  readonly fetch = async (
    input: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<Response> => {
    const request = new Request(input, init);
    const url = new URL(request.url);
    const path = url.pathname;
    const text = await request.text();
    const type = request.headers.get("content-type");
    // A file's bytes are recorded as they came, with their type.
    const body: unknown =
      text === ""
        ? undefined
        : type === "application/json"
          ? JSON.parse(text)
          : { contentType: type, text };
    this.requests.push({
      method: request.method,
      path,
      search: url.search.slice(1),
      body,
    });
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
      case "GET /api/events":
        return this.#events(url.searchParams);
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
      const command =
        rest === "/commands"
          ? (body as PrinterCommand)
          : simulatorCommand(rest, body);
      return this.#command(id, command, async () => {
        if (this.holdCommands) {
          await new Promise<void>((resolve) => this.#held.push(resolve));
        }
      });
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
      const text = typeof body === "object" && body !== null && "text" in body;
      const command: PrinterCommand = {
        kind: "file.upload",
        stagedFileId: eventId(0xf000 + this.#commands),
        fileName: decodeURIComponent(rest.slice("/files/".length)),
        sizeBytes: text
          ? new TextEncoder().encode(String(body.text)).length
          : 0,
      };
      return this.#command(id, command, async () => {
        if (this.holdUploads) {
          await new Promise<void>((resolve) => this.#heldUploads.push(resolve));
        }
      });
    }
    return undefined;
  }

  /**
   * Runs a command as the server does when all goes well: command.requested,
   * then (after `wait`) command.result, both by the session's user.
   */
  async #command(
    printerId: string,
    command: PrinterCommand,
    wait: () => Promise<void>,
  ): Promise<Response> {
    this.#commands += 1;
    const commandId = eventId(0xc000 + this.#commands);
    const envelope: Envelope = {
      correlationId: commandId,
      source:
        this.session === null
          ? { kind: "system" }
          : { kind: "user", userId: this.session.id },
    };
    this.publish(
      "command.requested",
      printerId,
      { commandId, command },
      envelope,
    );
    await wait();
    const result = { commandId, ok: true, durationMs: 1 };
    this.publish("command.result", printerId, result, envelope);
    return json(200, result);
  }

  /** GET /api/events: a page of the log, as the server answers it. */
  #events(search: URLSearchParams): Response {
    const query = EventsQuery.safeParse({
      printerId: search.get("printerId") ?? undefined,
      type: search.getAll("type"),
      category: search.getAll("category"),
      includeTelemetry: search.get("includeTelemetry") ?? undefined,
      before: search.get("before") ?? undefined,
      limit: search.get("limit") ?? undefined,
    });
    if (!query.success) {
      return apiError(400, "validation_failed", "The request isn't valid.");
    }
    const { printerId, type, category, includeTelemetry, before, limit } =
      query.data;
    const namesTelemetry =
      type.includes("printer.telemetry") || category.includes("telemetry");
    const rows = this.log
      .map((event, index) => ({ event, rowId: index + 1 }))
      .filter(
        ({ event, rowId }) =>
          (printerId === undefined || event.printerId === printerId) &&
          (type.length === 0 || type.includes(event.type)) &&
          (category.length === 0 || category.includes(event.category)) &&
          (includeTelemetry === "true" ||
            namesTelemetry ||
            event.category !== "telemetry") &&
          (before === undefined || rowId < before),
      )
      .reverse();
    const page = rows.slice(0, limit);
    const events = page.map((row) => row.event);
    const users = Object.fromEntries(
      this.users
        .filter((user) =>
          events.some(
            (event) =>
              event.source.kind === "user" && event.source.userId === user.id,
          ),
        )
        .map((user) => [user.id, user.username]),
    );
    return json(200, {
      events,
      nextCursor: rows.length > limit ? (page.at(-1)?.rowId ?? null) : null,
      users,
    });
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
    const secrets = this.#secrets(driverType, settings);
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
      { ...SIMULATED_DEFAULTS, ...secrets.settings },
      secrets.set,
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
    const secrets = this.#secrets(config.driverType, settings ?? {});
    const updated: PrinterConfig = {
      ...config,
      name: name ?? config.name,
      settings: { ...config.settings, ...secrets.settings },
      secretsSet: [...new Set([...config.secretsSet, ...secrets.set])],
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

  /** Settings without their secrets, and the secrets given a value. */
  #secrets(
    driverType: string,
    settings: PrinterConfig["settings"],
  ): { settings: PrinterConfig["settings"]; set: string[] } {
    const type = this.driverTypes.find((each) => each.type === driverType);
    const properties = (type?.settingsSchema.properties ?? {}) as Record<
      string,
      { writeOnly?: unknown }
    >;
    const writeOnly = new Set(
      Object.keys(properties).filter(
        (key) => properties[key]?.writeOnly === true,
      ),
    );
    return {
      settings: Object.fromEntries(
        Object.entries(settings).filter(([key]) => !writeOnly.has(key)),
      ),
      set: Object.entries(settings)
        .filter(([key, value]) => writeOnly.has(key) && value !== "")
        .map(([key]) => key),
    };
  }

  #exists(printerId: string): boolean {
    return this.printers.some((each) => each.printer.id === printerId);
  }

  #nameTaken(name: string): boolean {
    return [...this.configs.values()].some(
      (each) => each.name.toLowerCase() === name.toLowerCase(),
    );
  }

  #nextSeq(): number {
    this.#seq = this.#currentSeq() + 1;
    return this.#seq;
  }

  /** The seq of the newest event or snapshot. */
  #currentSeq(): number {
    return Math.max(this.#seq, ...this.printers.map((each) => each.seq));
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
        if (this.holdSnapshots.has(message.topic.name)) {
          this.#heldSnapshots.push(() => {
            this.#subscribe(socket, message.topic);
          });
        } else {
          this.#subscribe(socket, message.topic);
        }
        return;
      case "unsubscribe":
        this.#topics.get(socket)?.delete(topicKey(message.topic));
        return;
    }
  }

  /** The topic's snapshot, from which its events follow (as the hub does). */
  #subscribe(socket: FakeWebSocket, topic: Topic): void {
    if (socket.readyState !== OPEN) return;
    const seq = this.#currentSeq();
    if (topic.name !== "printer" || this.#exists(topic.printerId)) {
      const topics = this.#topics.get(socket) ?? new Map<string, Topic>();
      topics.set(topicKey(topic), topic);
      this.#topics.set(socket, topics);
    }
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

/** GET /api/events's query, as the server checks it. */
const EventsQuery = z.object({
  printerId: z.string().min(1).optional(),
  type: z.array(EventType),
  category: z.array(EventCategory),
  includeTelemetry: z.enum(["true", "false"]).optional(),
  before: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().min(1).max(500).default(100),
});

/** The simulator's routes, as the extension.invoke commands they run. */
function simulatorCommand(rest: string, body: unknown): PrinterCommand {
  const actions: Record<string, string> = {
    "/simulator/faults/error": "fault.error",
    "/simulator/faults/filament-runout": "fault.filament_runout",
    "/simulator/faults/disconnect": "fault.disconnect",
    "/simulator/clear": "clear",
    "/simulator/speed": "set_speed",
  };
  const action = actions[rest];
  if (action === undefined) throw new Error(`No simulator route ${rest}.`);
  return {
    kind: "extension.invoke",
    extension: "simulator",
    action,
    params: z.json().parse(body ?? {}),
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
