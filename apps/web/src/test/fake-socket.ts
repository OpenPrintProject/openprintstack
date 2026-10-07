// SPDX-FileCopyrightText: 2026 Open Print Stack contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  type EventType,
  type OpsEventOf,
  type PrinterSnapshot,
  WsClientMessage,
  WsServerMessage,
} from "@openprintstack/protocol";
import {
  eventFixtures,
  eventId,
  snapshotFixture,
} from "@openprintstack/protocol/fixtures";

// A stand-in for the browser's WebSocket that the test drives from the
// server's side. It behaves like the real one wherever the client could tell
// the difference:
//
//   readyState   CONNECTING → OPEN → CLOSING → CLOSED, never backwards
//   events       real Event, MessageEvent and CloseEvent objects, through
//                EventTarget (so listeners can be removed with a signal)
//   send()       throws InvalidStateError while CONNECTING, is silently
//                dropped once CLOSING or CLOSED, as browsers do
//   close()      refuses codes other than 1000 and 3000–4999, and reasons
//                over 123 bytes; while CONNECTING it fails the connection
//                (error, then close 1006, in a later task)
//   refused      a refused upgrade (401, 403) reaches the page only as an
//                error event and close 1006
//
// Every message is checked: what the page sends against WsClientMessage, and
// what the test sends against WsServerMessage.

const CONNECTING = 0;
const OPEN = 1;
const CLOSING = 2;
const CLOSED = 3;

export class FakeWebSocket extends EventTarget {
  static readonly CONNECTING = CONNECTING;
  static readonly OPEN = OPEN;
  static readonly CLOSING = CLOSING;
  static readonly CLOSED = CLOSED;

  readonly url: string;
  readyState: number = CONNECTING;
  /** What the page sent, in order. */
  readonly sent: WsClientMessage[] = [];
  /** The page called close(): with these. */
  closedWith: { code: number | undefined; reason: string } | undefined;
  /** Told of each message the page sends (FakeServer answers them). */
  onSent: ((message: WsClientMessage) => void) | undefined;

  constructor(url: string) {
    super();
    this.url = url;
  }

  // Typed like the browser's WebSocket (EventTarget's own listener type only
  // takes plain Events).
  override addEventListener(
    type: "message",
    listener: (event: MessageEvent) => void,
    options?: AddEventListenerOptions | boolean,
  ): void;
  override addEventListener(
    type: "close",
    listener: (event: CloseEvent) => void,
    options?: AddEventListenerOptions | boolean,
  ): void;
  override addEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject | null,
    options?: AddEventListenerOptions | boolean,
  ): void;
  override addEventListener(
    type: string,
    listener:
      ((event: never) => void) | EventListenerOrEventListenerObject | null,
    options?: AddEventListenerOptions | boolean,
  ): void {
    super.addEventListener(
      type,
      listener as EventListenerOrEventListenerObject | null,
      options,
    );
  }

  send(data: string): void {
    if (this.readyState === CONNECTING) {
      throw new DOMException(
        "Failed to execute 'send' on 'WebSocket': Still in CONNECTING state.",
        "InvalidStateError",
      );
    }
    if (this.readyState !== OPEN) return;
    const message = WsClientMessage.parse(JSON.parse(data));
    this.sent.push(message);
    this.onSent?.(message);
  }

  close(code?: number, reason = ""): void {
    if (code !== undefined && code !== 1000 && (code < 3000 || code > 4999)) {
      throw new DOMException(
        `The close code must be either 1000, or between 3000 and 4999. ${code} is neither.`,
        "InvalidAccessError",
      );
    }
    if (new TextEncoder().encode(reason).byteLength > 123) {
      throw new DOMException(
        "The close reason must not be greater than 123 UTF-8 bytes.",
        "SyntaxError",
      );
    }
    if (this.readyState === CLOSING || this.readyState === CLOSED) return;
    this.closedWith = { code, reason };
    const wasConnecting = this.readyState === CONNECTING;
    this.readyState = CLOSING;
    if (wasConnecting) {
      setTimeout(() => {
        this.dispatchEvent(new Event("error"));
        this.#finish(1006, "", false);
      }, 0);
    }
    // When open, the close event waits for the server: completeClose().
  }

  // The server's side.

  /** The upgrade succeeded. */
  accept(): void {
    this.#expect(CONNECTING, "accept");
    this.readyState = OPEN;
    this.dispatchEvent(new Event("open"));
  }

  /** The upgrade was refused (401, 403…): the page sees error, then 1006. */
  refuse(): void {
    this.#expect(CONNECTING, "refuse");
    this.dispatchEvent(new Event("error"));
    this.#finish(1006, "", false);
  }

  /** A message from the server, checked against WsServerMessage. */
  receive(message: WsServerMessage): void {
    WsServerMessage.parse(message);
    this.receiveRaw(JSON.stringify(message));
  }

  /** A message from the server, unchecked (for malformed ones). */
  receiveRaw(data: unknown): void {
    if (this.readyState !== OPEN && this.readyState !== CLOSING) {
      throw new Error(`receive() on a socket that is ${this.#state()}.`);
    }
    this.dispatchEvent(new MessageEvent("message", { data }));
  }

  /** The server closed the connection with a close frame. */
  serverClose(code: number, reason = ""): void {
    if (this.readyState !== OPEN && this.readyState !== CLOSING) {
      throw new Error(`serverClose() on a socket that is ${this.#state()}.`);
    }
    this.#finish(code, reason, true);
  }

  /** The connection was lost without a close frame. */
  drop(): void {
    this.#expect(OPEN, "drop");
    this.#finish(1006, "", false);
  }

  /** The server answered the page's close(). */
  completeClose(): void {
    this.#expect(CLOSING, "completeClose");
    this.#finish(
      this.closedWith?.code ?? 1005,
      this.closedWith?.reason ?? "",
      true,
    );
  }

  /** The topics the page has subscribed and not unsubscribed, in order. */
  topics(): string[] {
    const topics = new Map<string, true>();
    for (const message of this.sent) {
      if (message.type === "ping") continue;
      const key = JSON.stringify(message.topic);
      if (message.type === "subscribe") topics.set(key, true);
      else topics.delete(key);
    }
    return [...topics.keys()];
  }

  #finish(code: number, reason: string, wasClean: boolean): void {
    this.readyState = CLOSED;
    this.dispatchEvent(new CloseEvent("close", { code, reason, wasClean }));
  }

  #expect(state: number, method: string): void {
    if (this.readyState !== state) {
      throw new Error(`${method}() on a socket that is ${this.#state()}.`);
    }
  }

  #state(): string {
    return ["CONNECTING", "OPEN", "CLOSING", "CLOSED"][this.readyState] ?? "?";
  }
}

/** Every socket the page opened, in order. */
export class FakeSockets {
  readonly all: FakeWebSocket[] = [];

  readonly create = (url: string): FakeWebSocket => {
    const socket = new FakeWebSocket(url);
    this.all.push(socket);
    return socket;
  };

  /** The socket opened last. */
  get last(): FakeWebSocket {
    const socket = this.all.at(-1);
    if (socket === undefined) throw new Error("No socket has been opened.");
    return socket;
  }
}

/** One of protocol's event fixtures, as event number `seq`. */
export function eventOf<T extends EventType>(
  type: T,
  seq: number,
  changes: Partial<OpsEventOf<T>> = {},
): OpsEventOf<T> {
  return { ...eventFixtures[type], id: eventId(seq), seq, ...changes };
}

/** A printer's snapshot, from protocol's fixture. */
export function printerSnapshot(
  id: string,
  name: string,
  changes: { status?: PrinterSnapshot["state"]["status"]; seq?: number } = {},
): PrinterSnapshot {
  return {
    printer: { ...snapshotFixture.printer, id, name },
    state: {
      ...snapshotFixture.state,
      status: changes.status ?? snapshotFixture.state.status,
    },
    seq: changes.seq ?? snapshotFixture.seq,
  };
}
