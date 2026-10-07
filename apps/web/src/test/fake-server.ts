// SPDX-FileCopyrightText: 2026 Open Print Stack contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  ApiError,
  NewPassword,
  normalizePassword,
  type PrinterSnapshot,
  SessionUser,
  type Topic,
  Username,
  type WsClientMessage,
} from "@openprintstack/protocol";
import { BOOT_ID, USER_ID } from "@openprintstack/protocol/fixtures";
import { z } from "zod";

import { FakeSockets, type FakeWebSocket } from "./fake-socket.ts";

// The server, as the app's tests need it: users, one session, the auth
// routes with the real server's codes and messages, and a WebSocket hub that
// says hello only with a session (a refused upgrade otherwise) and answers
// subscribe and ping. Socket answers come in a later task, as over a real
// network, never inside the page's send().

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

  /** A server with rob as its admin, logged in or not. */
  static withUser(options: { loggedIn?: boolean } = {}): FakeServer {
    const server = new FakeServer();
    server.users = [ROB];
    if (options.loggedIn === true) server.session = sessionUser(ROB);
    return server;
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
    const body: unknown = text === "" ? undefined : JSON.parse(text);
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
      default:
        return apiError(404, "not_found", `There's nothing at ${route}.`);
    }
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
    const seq = Math.max(0, ...this.printers.map((printer) => printer.seq));
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
