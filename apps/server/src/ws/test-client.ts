// SPDX-FileCopyrightText: 2026 Open Print Stack contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

// Real sockets for the tests: the test app served on a free port, and a `ws`
// client that keeps every message it gets. Every wait has a time limit, so a
// broken server fails a test rather than hanging it. Not used by the server
// itself.

import type { IncomingHttpHeaders, Server } from "node:http";

import type { WsServerMessage } from "@openprintstack/protocol";
import { onTestFinished } from "vitest";
import { WebSocket } from "ws";

import { SESSION_COOKIE } from "../auth/sessions.ts";
import type { TestApp } from "../http/test-app.ts";
import { createHttpServer, listen } from "../server.ts";

/** The longest any single wait on a socket may take. */
export const WAIT_MS = 5000;

/** Serves the test app on 127.0.0.1 at a free port, as the server would. */
export async function serveTestApp(
  t: TestApp,
): Promise<{ url: string; port: number; server: Server }> {
  const server = createHttpServer(t.app);
  const port = await listen(server, "127.0.0.1", 0);
  onTestFinished(async () => {
    await t.hub.close();
    server.closeAllConnections();
    await new Promise<void>((resolve) => {
      server.close(() => {
        resolve();
      });
    });
  });
  return { url: `http://127.0.0.1:${port}`, port, server };
}

export type ConnectOptions = {
  /** The session cookie's token. */
  token?: string;
  /** The Origin header: the server's own origin by default; null sends none. */
  origin?: string | null;
  /** Sent as the Host header instead of the URL's. */
  host?: string;
};

function wsUrl(url: string): string {
  return `${url.replace(/^http/, "ws")}/api/ws`;
}

function newSocket(url: string, options: ConnectOptions): WebSocket {
  const headers: Record<string, string> = {};
  if (options.token !== undefined) {
    headers.Cookie = `${SESSION_COOKIE}=${options.token}`;
  }
  if (options.host !== undefined) headers.Host = options.host;
  const origin = options.origin === undefined ? url : options.origin;
  return new WebSocket(wsUrl(url), {
    headers,
    ...(origin !== null && { origin }),
  });
}

/**
 * The status of a refused upgrade, e.g. 401. Fails if the upgrade is
 * accepted or nothing comes back in time.
 */
export function upgradeStatus(
  url: string,
  options: ConnectOptions = {},
): Promise<number> {
  return new Promise((resolve, reject) => {
    const socket = newSocket(url, options);
    const timer = setTimeout(() => {
      socket.terminate();
      reject(new Error("No answer to the upgrade in time."));
    }, WAIT_MS);
    socket.on("unexpected-response", (request, response) => {
      clearTimeout(timer);
      resolve(response.statusCode ?? 0);
      request.destroy();
    });
    socket.on("open", () => {
      clearTimeout(timer);
      socket.terminate();
      reject(new Error("The upgrade was accepted."));
    });
    socket.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

export type Closed = { code: number; reason: string };

/** A connected client. Messages are read in order with `next`. */
export class TestClient {
  readonly socket: WebSocket;
  /** Every message received, in order. */
  readonly messages: WsServerMessage[] = [];
  /** The 101 response's headers. */
  readonly upgradeHeaders: IncomingHttpHeaders;
  /** Resolves when the socket closes. */
  readonly closed: Promise<Closed>;
  #read = 0;
  #closedWith: Closed | undefined;
  readonly #waiters = new Set<() => void>();

  private constructor(socket: WebSocket, upgradeHeaders: IncomingHttpHeaders) {
    this.socket = socket;
    this.upgradeHeaders = upgradeHeaders;
    socket.on("message", (data, isBinary) => {
      // The server only sends text, which `ws` gives as one Buffer.
      if (!isBinary && Buffer.isBuffer(data)) {
        this.messages.push(
          JSON.parse(data.toString("utf8")) as WsServerMessage,
        );
      }
      this.#wake();
    });
    this.closed = new Promise((resolve) => {
      socket.on("close", (code, reason) => {
        this.#closedWith = { code, reason: reason.toString() };
        resolve(this.#closedWith);
        this.#wake();
      });
    });
  }

  /** Opens a socket, closed when the test finishes. Fails if it's refused. */
  static connect(
    url: string,
    options: ConnectOptions = {},
  ): Promise<TestClient> {
    return new Promise((resolve, reject) => {
      const socket = newSocket(url, options);
      let headers: IncomingHttpHeaders = {};
      let client: TestClient | undefined;
      const timer = setTimeout(() => {
        socket.terminate();
        reject(new Error("The socket didn't open in time."));
      }, WAIT_MS);
      socket.on("upgrade", (response) => {
        headers = response.headers;
        // Listen before "open", so the first message can't be missed.
        client = new TestClient(socket, headers);
      });
      socket.on("open", () => {
        clearTimeout(timer);
        onTestFinished(() => {
          socket.terminate();
        });
        resolve(client ?? new TestClient(socket, headers));
      });
      socket.on("unexpected-response", (request, response) => {
        clearTimeout(timer);
        request.destroy();
        reject(new Error(`The upgrade was refused: ${response.statusCode}`));
      });
      socket.on("error", (error) => {
        clearTimeout(timer);
        reject(error);
      });
    });
  }

  send(message: unknown): void {
    this.socket.send(
      typeof message === "string" ? message : JSON.stringify(message),
    );
  }

  /** The next message not yet read. Fails after `timeoutMs` or on close. */
  async next(timeoutMs = WAIT_MS): Promise<WsServerMessage> {
    const deadline = Date.now() + timeoutMs;
    while (this.#read >= this.messages.length) {
      if (this.#closedWith !== undefined) {
        throw new Error(
          `The socket closed (${this.#closedWith.code}) while waiting for a message.`,
        );
      }
      await this.#change(deadline);
    }
    return this.messages[this.#read++]!;
  }

  /** Reads on to the next message that matches, skipping the rest. */
  async nextMatching(
    matches: (message: WsServerMessage) => boolean,
    timeoutMs = WAIT_MS,
  ): Promise<WsServerMessage> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const message = await this.next(Math.max(0, deadline - Date.now()));
      if (matches(message)) return message;
    }
  }

  /** How the socket closed. Fails if it's still open after `timeoutMs`. */
  async closing(timeoutMs = WAIT_MS): Promise<Closed> {
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        reject(new Error("The socket didn't close in time."));
      }, timeoutMs);
    });
    try {
      return await Promise.race([this.closed, timeout]);
    } finally {
      clearTimeout(timer);
    }
  }

  #change(deadline: number): Promise<void> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => {
          this.#waiters.delete(wake);
          const last = this.messages.slice(-5).map((m) => m.type);
          reject(
            new Error(
              `No message in time. ${this.messages.length} received, the last: ${JSON.stringify(last)}`,
            ),
          );
        },
        Math.max(0, deadline - Date.now()),
      );
      const wake = () => {
        clearTimeout(timer);
        this.#waiters.delete(wake);
        resolve();
      };
      this.#waiters.add(wake);
    });
  }

  #wake(): void {
    for (const wake of [...this.#waiters]) wake();
  }
}
