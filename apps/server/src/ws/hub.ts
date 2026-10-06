// SPDX-FileCopyrightText: 2026 Open Print Stack contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  type OpsEvent,
  type SessionUser,
  type Topic,
  WsClientMessage,
  WsServerMessage,
} from "@openprintstack/protocol";
import { z } from "zod";

import type { SessionService } from "../auth/sessions.ts";
import type { EventBus } from "../bus/bus.ts";
import type { Logger } from "../logger.ts";
import type { StateStore } from "../state/store.ts";
import { matchesTopic, topicKey } from "./topics.ts";

// Every open socket at /api/ws, its user and its topics. The route (route.ts)
// checks Host, Origin and the session before a socket gets here.
//
//   open         hello { bootId, user }, unless the session ended meanwhile
//   subscribe    the topic's snapshot, then each matching event as it's
//                published; again: a fresh snapshot
//   unsubscribe  no more events for it; unknown topics are ignored
//   ping         pong
//
// Snapshot before events: the snapshot is read and the topic registered in
// the same synchronous step, and the bus delivers synchronously, so the
// socket gets exactly the events after the snapshot's seq.
//
// Backpressure: while more than 1 MiB is waiting to go out to a socket,
// telemetry to it is dropped and each topic that lost some is marked stale.
// Once a send completes with less than 1 MiB waiting, each stale topic gets a
// fresh snapshot. Other events are never dropped; a socket with more than
// 16 MiB waiting is closed with 4008 and reconnects.
//
// Every 30 s each socket is pinged, and one that didn't answer the last ping
// is cut off. The same round closes sockets whose session has expired or was
// deleted (the pruner deletes expired sessions without telling anyone);
// logout and the session service's other deletions close them at once.

/** Close codes the hub uses. */
export const WS_CLOSE = {
  /** The server is shutting down. */
  goingAway: 1001,
  /** A message failed its check: a bug. */
  internalError: 1011,
  /** More than `maxBufferedBytes` waiting to go out. */
  tooFarBehind: 4008,
  /** The session ended: logout, expiry, deletion or a disabled user. */
  sessionEnded: 4401,
} as const;

const CLOSE_REASON = {
  [WS_CLOSE.goingAway]: "The server is shutting down.",
  [WS_CLOSE.internalError]: "Something went wrong on the server.",
  [WS_CLOSE.tooFarBehind]: "The connection fell too far behind.",
  [WS_CLOSE.sessionEnded]: "The session has ended.",
} as const;

type CloseCode = (typeof WS_CLOSE)[keyof typeof WS_CLOSE];

/** The `code` of an `error` message. */
export type WsErrorCode =
  "invalid_message" | "printer_not_found" | "too_many_topics";

export const WS_DEFAULTS = {
  pingIntervalMs: 30_000,
  /** Over this, telemetry is dropped until the socket catches up. */
  highWaterBytes: 1024 * 1024,
  /** Over this, the socket is closed with 4008. */
  maxBufferedBytes: 16 * 1024 * 1024,
  maxTopics: 100,
  /** How long `close()` waits for sockets to finish closing before cutting them off. */
  closeGraceMs: 2000,
} as const;

/** What the hub needs from a socket. `ws`'s WebSocket has all of it. */
export type HubSocket = {
  /** Bytes queued by `send` that haven't gone out to the network yet. */
  readonly bufferedAmount: number;
  /**
   * `callback` runs once the data has been written out (with null or no
   * error, as Node's streams call it) or has failed.
   */
  send(data: string, callback: (error?: Error | null) => void): void;
  close(code: number, reason: string): void;
  /** Sends a ping frame. Browsers answer with a pong frame by themselves. */
  ping(): void;
  /** Cuts the connection at once, without the closing handshake. */
  terminate(): void;
  on(event: "pong", listener: () => void): unknown;
};

/** Who is on the other end, from the session the upgrade was checked with. */
export type HubClient = {
  readonly user: SessionUser;
  readonly sessionId: string;
};

/** What the route tells the hub about one socket. */
export type HubConnection = {
  /** A message arrived: a string for text, anything else for binary. */
  receive(data: unknown): void;
  /** The socket has closed, whichever side closed it. */
  closed(code: number): void;
};

export type WsHubOptions = {
  bus: Pick<EventBus, "bootId" | "subscribe">;
  store: Pick<StateStore, "seq" | "get" | "list">;
  sessions: Pick<SessionService, "isActive" | "onSessionEnded">;
  logger: Logger;
  /**
   * Whether to Zod-check every message before it's sent. On by default; the
   * server turns it off in production.
   */
  validate?: boolean;
} & Partial<Record<keyof typeof WS_DEFAULTS, number>>;

type Subscription = {
  /** As the client last sent it; events and snapshots carry it back. */
  topic: Topic;
  /** Lost telemetry while the socket was behind; resynced when it catches up. */
  stale: boolean;
};

type Connection = {
  readonly socket: HubSocket;
  readonly client: HubClient;
  /** By `topicKey`. */
  readonly topics: Map<string, Subscription>;
  /** Answered the last ping (or hasn't been pinged yet). */
  alive: boolean;
  /** Telemetry has been dropped since it last caught up. */
  behind: boolean;
  /** The hub has closed or cut it off; nothing more is sent. */
  closing: boolean;
};

export class WsHub {
  readonly #bus: Pick<EventBus, "bootId">;
  readonly #store: Pick<StateStore, "seq" | "get" | "list">;
  readonly #sessions: Pick<SessionService, "isActive">;
  readonly #logger: Logger;
  readonly #validate: boolean;
  readonly #settings: Record<keyof typeof WS_DEFAULTS, number>;
  readonly #connections = new Set<Connection>();
  readonly #stopListening: () => void;
  readonly #timer: NodeJS.Timeout;
  #closing: Promise<void> | null = null;
  #allClosed: (() => void) | null = null;

  constructor(options: WsHubOptions) {
    this.#bus = options.bus;
    this.#store = options.store;
    this.#sessions = options.sessions;
    this.#logger = options.logger.child({ component: "ws" });
    this.#validate = options.validate ?? true;
    this.#settings = {
      pingIntervalMs: options.pingIntervalMs ?? WS_DEFAULTS.pingIntervalMs,
      highWaterBytes: options.highWaterBytes ?? WS_DEFAULTS.highWaterBytes,
      maxBufferedBytes:
        options.maxBufferedBytes ?? WS_DEFAULTS.maxBufferedBytes,
      maxTopics: options.maxTopics ?? WS_DEFAULTS.maxTopics,
      closeGraceMs: options.closeGraceMs ?? WS_DEFAULTS.closeGraceMs,
    };
    const unsubscribe = options.bus.subscribe("ws", (event) => {
      this.#deliver(event);
    });
    const stopSessions = options.sessions.onSessionEnded((sessionId) => {
      this.#endSession(sessionId);
    });
    this.#stopListening = () => {
      unsubscribe();
      stopSessions();
    };
    this.#timer = setInterval(() => {
      this.heartbeat();
    }, this.#settings.pingIntervalMs);
    // Open sockets keep the process alive; the timer alone mustn't.
    this.#timer.unref();
  }

  /** How many sockets are open (or closing). */
  get size(): number {
    return this.#connections.size;
  }

  /**
   * Takes over a socket that has just opened: sends `hello`, or closes it
   * with 4401 if its session ended after the upgrade was checked.
   */
  open(socket: HubSocket, client: HubClient): HubConnection {
    const connection: Connection = {
      socket,
      client,
      topics: new Map(),
      alive: true,
      behind: false,
      closing: false,
    };
    const handle: HubConnection = {
      receive: (data) => {
        this.#receive(connection, data);
      },
      closed: (code) => {
        this.#closed(connection, code);
      },
    };
    this.#connections.add(connection);
    socket.on("pong", () => {
      connection.alive = true;
    });
    if (this.#closing) {
      this.#close(connection, WS_CLOSE.goingAway);
    } else if (!this.#sessions.isActive(client.sessionId)) {
      // Registered first, so a session ending from here on closes it anyway.
      this.#close(connection, WS_CLOSE.sessionEnded);
    } else {
      this.#logger.debug({ userId: client.user.id }, "WebSocket opened");
      this.#send(connection, {
        type: "hello",
        bootId: this.#bus.bootId,
        user: client.user,
      });
    }
    return handle;
  }

  /**
   * One keep-alive round, which the hub runs every 30 s: closes sockets whose
   * session is no longer active (4401), cuts off sockets that didn't answer
   * the previous ping, and pings the rest.
   */
  heartbeat(): void {
    const active = new Map<string, boolean>();
    for (const connection of [...this.#connections]) {
      if (connection.closing) continue;
      const { sessionId } = connection.client;
      let isActive = active.get(sessionId);
      if (isActive === undefined) {
        isActive = this.#sessions.isActive(sessionId);
        active.set(sessionId, isActive);
      }
      if (!isActive) {
        this.#close(connection, WS_CLOSE.sessionEnded);
        continue;
      }
      if (!connection.alive) {
        this.#logger.debug(
          { userId: connection.client.user.id },
          "Cut off a WebSocket that didn't answer its ping",
        );
        connection.closing = true;
        connection.socket.terminate();
        continue;
      }
      connection.alive = false;
      connection.socket.ping();
    }
  }

  /**
   * Stops taking events and closes every socket with 1001. Resolves once all
   * have closed; any still open after `closeGraceMs` are cut off.
   */
  close(): Promise<void> {
    this.#closing ??= this.#shutdown();
    return this.#closing;
  }

  async #shutdown(): Promise<void> {
    clearInterval(this.#timer);
    this.#stopListening();
    for (const connection of this.#connections) {
      if (!connection.closing) this.#close(connection, WS_CLOSE.goingAway);
    }
    if (this.#connections.size === 0) return;
    const allClosed = new Promise<void>((resolve) => {
      this.#allClosed = resolve;
    });
    const grace = setTimeout(() => {
      for (const connection of this.#connections) connection.socket.terminate();
    }, this.#settings.closeGraceMs);
    try {
      await allClosed;
    } finally {
      clearTimeout(grace);
    }
  }

  #receive(connection: Connection, data: unknown): void {
    if (connection.closing) return;
    if (typeof data !== "string") {
      this.#error(
        connection,
        "invalid_message",
        "Messages must be JSON text, not binary.",
      );
      return;
    }
    let json: unknown;
    try {
      json = JSON.parse(data);
    } catch {
      this.#error(connection, "invalid_message", "The message isn't JSON.");
      return;
    }
    const parsed = WsClientMessage.safeParse(json);
    if (!parsed.success) {
      this.#error(
        connection,
        "invalid_message",
        `The message isn't valid. ${z.prettifyError(parsed.error)}`,
      );
      return;
    }
    const message = parsed.data;
    switch (message.type) {
      case "subscribe":
        this.#subscribe(connection, message.topic);
        return;
      case "unsubscribe":
        connection.topics.delete(topicKey(message.topic));
        return;
      case "ping":
        this.#send(connection, { type: "pong" });
        return;
    }
  }

  #subscribe(connection: Connection, topic: Topic): void {
    const key = topicKey(topic);
    if (
      !connection.topics.has(key) &&
      connection.topics.size >= this.#settings.maxTopics
    ) {
      this.#error(
        connection,
        "too_many_topics",
        `A connection can have at most ${this.#settings.maxTopics} topics. Unsubscribe from one first.`,
        topic,
      );
      return;
    }
    if (
      topic.name === "printer" &&
      this.#store.get(topic.printerId) === undefined
    ) {
      this.#error(
        connection,
        "printer_not_found",
        `There is no printer ${topic.printerId}.`,
        topic,
      );
      return;
    }
    // Read and registered in one synchronous step: see the top of the file.
    const snapshot = this.#snapshot(topic);
    connection.topics.set(key, { topic, stale: false });
    if (snapshot !== undefined) this.#send(connection, snapshot);
  }

  /** The topic's snapshot now, or undefined for a printer that doesn't exist. */
  #snapshot(topic: Topic): WsServerMessage | undefined {
    const seq = this.#store.seq;
    switch (topic.name) {
      case "fleet":
        return { type: "snapshot", topic, seq, data: this.#store.list() };
      case "printer": {
        const data = this.#store.get(topic.printerId);
        return data && { type: "snapshot", topic, seq, data };
      }
      case "events":
        return { type: "snapshot", topic, seq, data: null };
    }
  }

  /** The bus calls this with every event, in publish order. */
  #deliver(event: OpsEvent): void {
    for (const connection of this.#connections) {
      if (connection.closing) continue;
      const dropTelemetry =
        event.category === "telemetry" &&
        connection.socket.bufferedAmount > this.#settings.highWaterBytes;
      for (const [key, subscription] of connection.topics) {
        if (!matchesTopic(subscription.topic, event)) continue;
        if (dropTelemetry) {
          this.#fallBehind(connection, subscription);
          continue;
        }
        this.#send(connection, {
          type: "event",
          topic: subscription.topic,
          event,
        });
        if (connection.closing) break;
        // Printer ids are never reused, so nothing more can arrive for it.
        if (
          event.type === "printer.removed" &&
          subscription.topic.name === "printer"
        ) {
          connection.topics.delete(key);
        }
      }
    }
  }

  #fallBehind(connection: Connection, subscription: Subscription): void {
    subscription.stale = true;
    if (connection.behind) return;
    connection.behind = true;
    this.#logger.debug(
      {
        userId: connection.client.user.id,
        bufferedBytes: connection.socket.bufferedAmount,
      },
      "A WebSocket fell behind; dropping its telemetry until it catches up",
    );
  }

  /** A send completed. Resyncs stale topics once the socket has caught up. */
  #sent(connection: Connection, error: Error | null | undefined): void {
    if (error != null || connection.closing || !connection.behind) return;
    if (connection.socket.bufferedAmount >= this.#settings.highWaterBytes) {
      return;
    }
    connection.behind = false;
    const stale = [...connection.topics.values()].filter((s) => s.stale);
    this.#logger.debug(
      { userId: connection.client.user.id, topics: stale.length },
      "A WebSocket caught up; resyncing the topics that lost telemetry",
    );
    for (const subscription of stale) {
      subscription.stale = false;
      const snapshot = this.#snapshot(subscription.topic);
      if (snapshot !== undefined) this.#send(connection, snapshot);
    }
  }

  #error(
    connection: Connection,
    code: WsErrorCode,
    message: string,
    topic?: Topic,
  ): void {
    this.#send(connection, {
      type: "error",
      code,
      message,
      ...(topic !== undefined && { topic }),
    });
  }

  #send(connection: Connection, message: WsServerMessage): void {
    if (connection.closing) return;
    if (this.#validate) {
      const checked = WsServerMessage.safeParse(message);
      if (!checked.success) {
        this.#logger.error(
          {
            err: checked.error,
            userId: connection.client.user.id,
            messageType: message.type,
          },
          "A WebSocket message failed its check; closed the socket",
        );
        this.#close(connection, WS_CLOSE.internalError);
        return;
      }
    }
    connection.socket.send(JSON.stringify(message), (error) => {
      this.#sent(connection, error);
    });
    if (connection.socket.bufferedAmount > this.#settings.maxBufferedBytes) {
      this.#logger.warn(
        {
          userId: connection.client.user.id,
          bufferedBytes: connection.socket.bufferedAmount,
        },
        "Closed a WebSocket that fell too far behind",
      );
      this.#close(connection, WS_CLOSE.tooFarBehind);
    }
  }

  #endSession(sessionId: string): void {
    for (const connection of this.#connections) {
      if (connection.client.sessionId === sessionId && !connection.closing) {
        this.#close(connection, WS_CLOSE.sessionEnded);
      }
    }
  }

  #close(connection: Connection, code: CloseCode): void {
    connection.closing = true;
    connection.socket.close(code, CLOSE_REASON[code]);
  }

  #closed(connection: Connection, code: number): void {
    if (!this.#connections.delete(connection)) return;
    this.#logger.debug(
      { userId: connection.client.user.id, code },
      "WebSocket closed",
    );
    if (this.#connections.size === 0) this.#allClosed?.();
  }
}
