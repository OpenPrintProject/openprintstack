// SPDX-FileCopyrightText: 2026 Open Print Stack contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  type OpsEvent,
  Topic,
  topicKey,
  type WsClientMessage,
  WsServerMessage,
} from "@openprintstack/protocol";
import { z } from "zod";

import type { SignedOutReason } from "../api/client.ts";
import { backoffDelay } from "./backoff.ts";

// One WebSocket to /api/ws, shared by everything on the page that shows live
// data. It doesn't know about React or the Query cache: it hands each topic's
// snapshots and events to a sink (cache.ts, in the app).
//
//   start      connect; hello { bootId } → live, and every topic in use is
//              subscribed (again); a new bootId means the server restarted,
//              so the sink drops everything first
//   retain     a component needs a topic; the first one subscribes it. Topics
//              are counted by protocol's topicKey, as the server keys them
//   release    the last one gone (checked a microtask later, so a component
//              that remounts at once keeps it) unsubscribes it
//   messages   a topic's events wait for its snapshot, and only events newer
//              than what it has (by seq) are applied; every message is
//              checked against protocol's WsServerMessage
//
// When the connection ends:
//
//   4401         the session ended: onSignedOut, and no more reconnecting
//   before hello a refused upgrade (browsers only show close 1006), the
//                server down, or no hello within 10 s: ask GET /api/auth/me
//                whether the session is gone; if not, reconnect with backoff
//   4008         the server dropped us for falling behind: reconnect at once
//   otherwise    reconnect with backoff (1001 shutdown, 1011 a server bug,
//                1009 our bug, 1006 a lost connection, no pong)
//
// Liveness: browsers don't show pages the server's ping frames, so after 25 s
// with nothing heard the client sends a ping, and gives up on the connection
// if nothing arrives within 10 s more.

export type ConnectionStatus =
  /** Not connected yet since start(). */
  | "connecting"
  | "live"
  /** Lost the connection; trying again. */
  | "reconnecting"
  /** Several attempts in a row have failed; still trying. */
  | "unreachable"
  /** stop() was called, or the session ended. */
  | "stopped";

/** What the client needs of the browser's WebSocket. */
export type RealtimeSocket = {
  readonly readyState: number;
  send(data: string): void;
  close(code?: number, reason?: string): void;
  addEventListener(
    type: "message",
    listener: (event: MessageEvent) => void,
    options: { signal: AbortSignal },
  ): void;
  addEventListener(
    type: "close",
    listener: (event: CloseEvent) => void,
    options: { signal: AbortSignal },
  ): void;
};

/** What GET /api/auth/me says: no answer (or a failure) is "unknown". */
export type SessionCheck = "active" | SignedOutReason | "unknown";

export type SnapshotMessage = Extract<WsServerMessage, { type: "snapshot" }>;

/** Where a topic's data goes. */
export type RealtimeSink = {
  /** A topic's snapshot, which replaces whatever it had. */
  snapshot(message: SnapshotMessage): void;
  /**
   * One of a topic's events, after its snapshot and newer than anything
   * before. "resync" asks for a fresh snapshot (the event can't be applied
   * from what's known).
   */
  event(topic: Topic, event: OpsEvent): "applied" | "resync";
  /** The server refused to subscribe the topic, e.g. `printer_not_found`. */
  refused(topic: Topic, code: string): void;
  /** No component uses the topic any more. */
  dropped(topic: Topic): void;
  /** The server restarted: every topic's data is out of date. */
  reset(): void;
};

export type RealtimeClientOptions = {
  /** ws://…/api/ws */
  url: string;
  createSocket: (url: string) => RealtimeSocket;
  sink: RealtimeSink;
  checkSession: () => Promise<SessionCheck>;
  /** The session has ended: the client has stopped. */
  onSignedOut: (reason: SignedOutReason) => void;
  /** For tests; Math.random by default. */
  random?: () => number;
  /** console by default. */
  log?: Pick<Console, "error">;
};

export const REALTIME_TIMING = {
  /** With nothing heard for this long, the client sends a ping. */
  quietMs: 25_000,
  /**
   * How long to wait for an answer: hello after connecting, anything after a
   * ping, and the session check.
   */
  answerMs: 10_000,
  /** Failed attempts in a row before the status says "unreachable". */
  unreachableAfter: 5,
} as const;

/** Close codes the client acts on, or closes with. */
export const CLOSE = {
  normal: 1000,
  tooBig: 1009,
  serverError: 1011,
  /** The client's own: no answer in time. */
  noAnswer: 4000,
  tooFarBehind: 4008,
  sessionEnded: 4401,
} as const;

/** WebSocket.CONNECTING and OPEN. */
const CONNECTING = 0;
const OPEN = 1;

type Subscription = {
  /** As first retained: what's sent to the server. */
  readonly topic: Topic;
  /** How many components use it. */
  refs: number;
  /** Its snapshot has arrived since it was last subscribed. */
  synced: boolean;
  /** The seq of the snapshot or event last applied. */
  seq: number;
};

type Connection = {
  readonly socket: RealtimeSocket;
  /** Aborted to remove the socket's listeners. */
  readonly listening: AbortController;
  /** hello has arrived. */
  greeted: boolean;
};

type Timer = ReturnType<typeof setTimeout>;

export class RealtimeClient {
  readonly #options: RealtimeClientOptions;
  readonly #log: Pick<Console, "error">;
  readonly #subscriptions = new Map<string, Subscription>();
  readonly #statusListeners = new Set<() => void>();
  #status: ConnectionStatus = "stopped";
  #running = false;
  /** hello has arrived since start(). */
  #wasLive = false;
  #connection: Connection | null = null;
  #bootId: string | null = null;
  /** Attempts in a row that ended before hello. */
  #failures = 0;
  /** Changed by stop(), so a session check that answers late is ignored. */
  #generation = 0;
  #reconnectTimer: Timer | undefined;
  #quietTimer: Timer | undefined;
  #answerTimer: Timer | undefined;

  constructor(options: RealtimeClientOptions) {
    this.#options = options;
    this.#log = options.log ?? console;
  }

  get status(): ConnectionStatus {
    return this.#status;
  }

  /** Calls `listener` whenever `status` changes; returns a function that stops. */
  onStatus(listener: () => void): () => void {
    this.#statusListeners.add(listener);
    return () => {
      this.#statusListeners.delete(listener);
    };
  }

  start(): void {
    if (this.#running) return;
    this.#running = true;
    this.#wasLive = false;
    this.#failures = 0;
    this.#setStatus("connecting");
    this.#connect();
  }

  /** Closes the connection; topics stay retained for a later start(). */
  stop(): void {
    if (!this.#running) return;
    this.#halt();
    this.#setStatus("stopped");
  }

  /**
   * Subscribes `topic` while anything retains it. Returns the release
   * function, which only counts once.
   */
  retain(topic: Topic): () => void {
    const key = topicKey(topic);
    let subscription = this.#subscriptions.get(key);
    if (subscription === undefined) {
      subscription = { topic, refs: 0, synced: false, seq: -1 };
      this.#subscriptions.set(key, subscription);
      this.#subscribe(subscription);
    }
    subscription.refs += 1;
    const retained = subscription;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.#release(key, retained);
    };
  }

  /** Asks for a fresh snapshot of a topic in use; its events wait for it. */
  resync(topic: Topic): void {
    const subscription = this.#subscriptions.get(topicKey(topic));
    if (subscription !== undefined) this.#subscribe(subscription);
  }

  #release(key: string, subscription: Subscription): void {
    subscription.refs -= 1;
    if (subscription.refs > 0) return;
    queueMicrotask(() => {
      if (
        subscription.refs > 0 ||
        this.#subscriptions.get(key) !== subscription
      ) {
        return;
      }
      this.#subscriptions.delete(key);
      this.#send({ type: "unsubscribe", topic: subscription.topic });
      this.#options.sink.dropped(subscription.topic);
    });
  }

  #subscribe(subscription: Subscription): void {
    subscription.synced = false;
    this.#send({ type: "subscribe", topic: subscription.topic });
  }

  /** Sends only on a live connection; after hello, every topic is sent. */
  #send(message: WsClientMessage): void {
    const connection = this.#connection;
    if (connection?.greeted !== true || connection.socket.readyState !== OPEN) {
      return;
    }
    connection.socket.send(JSON.stringify(message));
  }

  #connect(): void {
    this.#reconnectTimer = undefined;
    const socket = this.#options.createSocket(this.#options.url);
    const connection: Connection = {
      socket,
      listening: new AbortController(),
      greeted: false,
    };
    this.#connection = connection;
    const { signal } = connection.listening;
    socket.addEventListener(
      "message",
      (event) => {
        this.#received(connection, event.data);
      },
      { signal },
    );
    socket.addEventListener(
      "close",
      (event) => {
        this.#closed(connection, event.code);
      },
      { signal },
    );
    // A stalled connection can take minutes to fail by itself.
    this.#answerTimer = setTimeout(() => {
      this.#noAnswer(connection);
    }, REALTIME_TIMING.answerMs);
  }

  #received(connection: Connection, data: unknown): void {
    if (connection.greeted) this.#heard(connection);
    if (typeof data !== "string") {
      this.#log.error(
        "The server sent a binary WebSocket message; ignored it.",
      );
      return;
    }
    let json: unknown;
    try {
      json = JSON.parse(data);
    } catch {
      this.#log.error("The server sent a WebSocket message that isn't JSON.");
      this.#invalid(connection, undefined);
      return;
    }
    const parsed = WsServerMessage.safeParse(json);
    if (!parsed.success) {
      this.#log.error(
        `The server sent a WebSocket message that isn't valid; resyncing. ${z.prettifyError(parsed.error)}`,
      );
      this.#invalid(connection, json);
      return;
    }
    const message = parsed.data;
    switch (message.type) {
      case "hello":
        this.#hello(connection, message.bootId);
        return;
      case "snapshot":
        this.#snapshot(message);
        return;
      case "event":
        this.#event(message.topic, message.event);
        return;
      case "error":
        this.#error(message.code, message.message, message.topic);
        return;
      case "pong":
        return;
    }
  }

  #hello(connection: Connection, bootId: string): void {
    if (connection.greeted) return;
    connection.greeted = true;
    this.#wasLive = true;
    this.#failures = 0;
    // A new bootId: the server restarted. Its seqs start again from 0, which
    // is fine here: every topic's events wait for its new snapshot, and the
    // snapshot sets its seq.
    if (this.#bootId !== null && this.#bootId !== bootId) {
      this.#options.sink.reset();
    }
    this.#bootId = bootId;
    this.#setStatus("live");
    this.#heard(connection);
    for (const subscription of this.#subscriptions.values()) {
      this.#subscribe(subscription);
    }
  }

  #snapshot(message: SnapshotMessage): void {
    const subscription = this.#subscriptions.get(topicKey(message.topic));
    if (subscription === undefined) return;
    subscription.synced = true;
    subscription.seq = message.seq;
    this.#options.sink.snapshot(message);
  }

  #event(topic: Topic, event: OpsEvent): void {
    const subscription = this.#subscriptions.get(topicKey(topic));
    if (
      subscription === undefined ||
      !subscription.synced ||
      event.seq <= subscription.seq
    ) {
      return;
    }
    subscription.seq = event.seq;
    if (this.#options.sink.event(subscription.topic, event) === "resync") {
      this.#subscribe(subscription);
    }
  }

  #error(code: string, message: string, topic: Topic | undefined): void {
    const subscription =
      topic === undefined
        ? undefined
        : this.#subscriptions.get(topicKey(topic));
    if (subscription !== undefined) {
      this.#options.sink.refused(subscription.topic, code);
    }
    if (code !== "printer_not_found") {
      this.#log.error(
        `The server refused a WebSocket message: ${code}: ${message}`,
      );
    }
  }

  /**
   * A message failed its check. Before hello the connection is no use; after
   * it, the topic the message was for (or, if that's unclear, every topic)
   * gets a fresh snapshot, so nothing is missed.
   */
  #invalid(connection: Connection, json: unknown): void {
    if (!connection.greeted) {
      this.#abandon(CLOSE.noAnswer, "The server's messages aren't valid.");
      this.#failed();
      return;
    }
    const topic = Topic.safeParse(
      typeof json === "object" && json !== null && "topic" in json
        ? json.topic
        : undefined,
    );
    const subscription = topic.success
      ? this.#subscriptions.get(topicKey(topic.data))
      : undefined;
    const stale =
      subscription === undefined
        ? [...this.#subscriptions.values()]
        : [subscription];
    for (const each of stale) this.#subscribe(each);
  }

  #closed(connection: Connection, code: number): void {
    if (connection !== this.#connection) return;
    this.#detach();
    if (!this.#running) return;
    if (code === CLOSE.sessionEnded) {
      this.#signOut("unauthenticated");
      return;
    }
    if (code === CLOSE.tooBig) {
      this.#log.error(
        "The server closed the WebSocket because a message from this page was too big (1009): a bug.",
      );
    } else if (code === CLOSE.serverError) {
      this.#log.error(
        "The server closed the WebSocket after an error of its own (1011).",
      );
    }
    if (!connection.greeted) {
      this.#failed();
    } else {
      this.#reconnect(code === CLOSE.tooFarBehind ? 0 : undefined);
    }
  }

  /** No hello in time after connecting, or no answer to a ping. */
  #noAnswer(connection: Connection): void {
    if (connection !== this.#connection) return;
    this.#abandon(CLOSE.noAnswer, "No answer from the server.");
    if (!connection.greeted) {
      this.#failed();
    } else {
      this.#reconnect();
    }
  }

  /** An attempt ended before hello: was the upgrade refused for no session? */
  #failed(): void {
    this.#failures += 1;
    this.#setStatus(this.#retryingStatus());
    const generation = this.#generation;
    void this.#checkSession().then((result) => {
      if (generation !== this.#generation) return;
      if (result === "setup_required" || result === "unauthenticated") {
        this.#signOut(result);
      } else {
        this.#reconnect();
      }
    });
  }

  async #checkSession(): Promise<SessionCheck> {
    let timer: Timer | undefined;
    const timeout = new Promise<SessionCheck>((resolve) => {
      timer = setTimeout(() => {
        resolve("unknown");
      }, REALTIME_TIMING.answerMs);
    });
    try {
      return await Promise.race([
        this.#options.checkSession().catch(() => "unknown" as const),
        timeout,
      ]);
    } finally {
      clearTimeout(timer);
    }
  }

  /** Connects again after the backoff, or after `delayMs`. */
  #reconnect(delayMs?: number): void {
    this.#setStatus(this.#retryingStatus());
    const delay = delayMs ?? backoffDelay(this.#failures, this.#options.random);
    this.#reconnectTimer = setTimeout(() => {
      this.#connect();
    }, delay);
  }

  #retryingStatus(): ConnectionStatus {
    if (this.#failures >= REALTIME_TIMING.unreachableAfter) {
      return "unreachable";
    }
    return this.#wasLive ? "reconnecting" : "connecting";
  }

  /** Restarts the quiet timer: after 25 s of silence, ping. */
  #heard(connection: Connection): void {
    clearTimeout(this.#answerTimer);
    clearTimeout(this.#quietTimer);
    this.#quietTimer = setTimeout(() => {
      this.#send({ type: "ping" });
      this.#answerTimer = setTimeout(() => {
        this.#noAnswer(connection);
      }, REALTIME_TIMING.answerMs);
    }, REALTIME_TIMING.quietMs);
  }

  #signOut(reason: SignedOutReason): void {
    this.#halt();
    this.#setStatus("stopped");
    this.#options.onSignedOut(reason);
  }

  /** Stops everything: no socket, no timers, no reconnecting. */
  #halt(): void {
    this.#running = false;
    this.#generation += 1;
    clearTimeout(this.#reconnectTimer);
    this.#reconnectTimer = undefined;
    this.#abandon(CLOSE.normal, "The page closed the connection.");
  }

  /** Stops listening to the socket and closes it, without waiting. */
  #abandon(code: number, reason: string): void {
    const connection = this.#connection;
    if (connection === null) return;
    this.#detach();
    const { readyState } = connection.socket;
    if (readyState === CONNECTING || readyState === OPEN) {
      connection.socket.close(code, reason);
    }
  }

  /** Forgets the current socket; its topics must be subscribed again. */
  #detach(): void {
    this.#connection?.listening.abort();
    this.#connection = null;
    clearTimeout(this.#quietTimer);
    clearTimeout(this.#answerTimer);
    for (const subscription of this.#subscriptions.values()) {
      subscription.synced = false;
    }
  }

  #setStatus(status: ConnectionStatus): void {
    if (status === this.#status) return;
    this.#status = status;
    for (const listener of this.#statusListeners) listener();
  }
}
