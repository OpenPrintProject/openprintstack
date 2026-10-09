// SPDX-FileCopyrightText: 2026 Open Print Stack contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { connect, type MqttClient } from "mqtt";

import {
  isEcho,
  type JsonObject,
  MethodMessage,
  MQTT_USERNAME,
  newClientId,
  newRequestId,
  parsePayload,
  PING,
  Pong,
  RegisterResponse,
  type Topics,
  topicsFor,
} from "./protocol.ts";

// One MQTT connection to a CC2, from login to close:
//
//   1. connect as `elegoo`, with the access code as the password
//   2. register this client, waiting up to 3 s for the printer's answer
//   3. subscribe to the status deltas and to this client's responses
//   4. PING every 10 s, and give up after 30 s without a word from the printer
//
// The printer allows only about 4 clients at once, counting the slicer and its
// own web page, so a session always closes cleanly to free its place.

/** Why a session couldn't open. */
export type OpenFailure =
  /** No answer, or the connection closed before the session was ready. */
  | { readonly kind: "unreachable" }
  | { readonly kind: "access_code_rejected" }
  | { readonly kind: "too_many_clients" }
  | { readonly kind: "register_failed"; readonly reason: string };

export class OpenError extends Error {
  override name = "OpenError";
  readonly failure: OpenFailure;

  constructor(failure: OpenFailure, message: string, options?: ErrorOptions) {
    super(message, options);
    this.failure = failure;
  }
}

/** A reply whose `error_code` isn't 0. */
export class ResponseError extends Error {
  override name = "ResponseError";
  readonly errorCode: number;

  constructor(method: number, errorCode: number) {
    super(`The printer answered method ${method} with error ${errorCode}.`);
    this.errorCode = errorCode;
  }
}

/**
 * Why an open session closed: `lost` (the connection dropped), `silent` (no
 * word from the printer for too long) or `closed` (by `close`).
 */
export type CloseReason = "lost" | "silent" | "closed";

export type SessionOptions = {
  readonly host: string;
  readonly port: number;
  readonly serial: string;
  readonly accessCode: string;
  readonly connectMs: number;
  readonly registerMs: number;
  readonly requestMs: number;
  readonly heartbeatMs: number;
  readonly silenceMs: number;
  /** Aborts opening. It has no effect once the session is open. */
  readonly signal?: AbortSignal;
};

export type SessionHandlers = {
  /** A status delta (event 6000). */
  onStatusEvent(message: MethodMessage): void;
};

type Pending = {
  resolve(message: MethodMessage): void;
  reject(error: Error): void;
};

/** How long a clean close may take before the socket is just dropped. */
const CLOSE_MS = 1000;

export class Cc2Session {
  readonly clientId: string;
  /** Names the topic the printer answers our registration on. */
  readonly requestId: string;
  /** Resolves once the session has closed, with the reason. */
  readonly closed: Promise<CloseReason>;

  readonly #client: MqttClient;
  readonly #topics: Topics;
  readonly #options: SessionOptions;
  readonly #handlers: SessionHandlers;
  readonly #pending = new Map<number, Pending>();
  #nextId = 1;
  #heartbeat: ReturnType<typeof setInterval> | undefined;
  #silence: ReturnType<typeof setTimeout> | undefined;
  /** Set once the session has closed or started closing. */
  #closeReason: CloseReason | null = null;
  readonly #resolveClosed: (reason: CloseReason) => void;
  /** Takes the answer to our registration, while waiting for it. */
  #registration: {
    answer(payload: unknown): void;
    cancel(error: Error): void;
  } | null = null;

  private constructor(
    client: MqttClient,
    clientId: string,
    requestId: string,
    options: SessionOptions,
    handlers: SessionHandlers,
  ) {
    this.#client = client;
    this.clientId = clientId;
    this.requestId = requestId;
    this.#topics = topicsFor(options.serial, clientId, requestId);
    this.#options = options;
    this.#handlers = handlers;
    const { promise, resolve } = Promise.withResolvers<CloseReason>();
    this.closed = promise;
    this.#resolveClosed = resolve;
  }

  /**
   * Connects, registers and subscribes. Fails with an `OpenError`, or with
   * the signal's reason if it aborts; either way nothing is left open.
   */
  static async open(
    options: SessionOptions,
    handlers: SessionHandlers,
  ): Promise<Cc2Session> {
    options.signal?.throwIfAborted();
    const clientId = newClientId();
    const client = connect({
      host: options.host,
      port: options.port,
      protocol: "mqtt",
      protocolVersion: 4,
      clientId,
      username: MQTT_USERNAME,
      password: options.accessCode,
      clean: true,
      connectTimeout: options.connectMs,
      // We reconnect ourselves, with backoff, as a new session.
      reconnectPeriod: 0,
      resubscribe: false,
      queueQoSZero: false,
    });
    // mqtt.js throws an "error" that nobody listens to. Every failure also
    // closes the connection, which is what's watched.
    client.on("error", () => undefined);
    const session = new Cc2Session(
      client,
      clientId,
      newRequestId(),
      options,
      handlers,
    );
    try {
      await session.#open();
      return session;
    } catch (error) {
      session.#drop();
      throw error;
    }
  }

  /**
   * Sends a request and resolves with its result. Fails with a
   * `ResponseError` if the printer reports an error, or an `Error` if it
   * doesn't answer in time or the session closes first.
   */
  request(method: number, params: JsonObject = {}): Promise<JsonObject> {
    if (this.#closeReason !== null) {
      return Promise.reject(new Error("The session has closed."));
    }
    const id = this.#nextId++;
    return new Promise<MethodMessage>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#pending.delete(id);
        reject(new Error(`No answer to method ${method} in time.`));
      }, this.#options.requestMs);
      this.#pending.set(id, {
        resolve: (message) => {
          clearTimeout(timer);
          resolve(message);
        },
        reject: (error) => {
          clearTimeout(timer);
          reject(error);
        },
      });
      this.#client.publish(
        this.#topics.request,
        JSON.stringify({ id, method, params }),
        { qos: 1 },
      );
    }).then(({ result }) => {
      const errorCode = result.error_code;
      if (typeof errorCode === "number" && errorCode !== 0) {
        throw new ResponseError(method, errorCode);
      }
      return result;
    });
  }

  /** Closes cleanly, so the printer frees this client's place at once. */
  async close(): Promise<void> {
    if (this.#closeReason !== null) {
      await this.closed;
      return;
    }
    this.#finish("closed");
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        this.#client.end(true);
        resolve();
      }, CLOSE_MS);
      this.#client.end(false, {}, () => {
        clearTimeout(timer);
        resolve();
      });
    });
  }

  async #open(): Promise<void> {
    const { signal } = this.#options;
    const abort = () => this.#drop();
    signal?.addEventListener("abort", abort, { once: true });
    try {
      this.#client.on("message", (topic, payload) => {
        this.#receive(topic, payload);
      });
      await this.#connected();
      await this.#register();
      await this.#client.subscribeAsync(
        [this.#topics.status, this.#topics.response],
        { qos: 1 },
      );
      signal?.throwIfAborted();
    } catch (error) {
      signal?.throwIfAborted();
      throw error;
    } finally {
      signal?.removeEventListener("abort", abort);
    }

    // From here on the session is open: watch it until it closes.
    this.#client.on("close", () => this.#finish("lost"));
    this.#heartbeat = setInterval(
      () => this.#ping(),
      this.#options.heartbeatMs,
    );
    this.#ping();
    this.#heard();
  }

  /** Waits for the login to be accepted. */
  #connected(): Promise<void> {
    const client = this.#client;
    return new Promise<void>((resolve, reject) => {
      const done = () => {
        client.off("connect", onConnect);
        client.off("error", onError);
        client.off("close", onClose);
      };
      const onConnect = () => {
        done();
        resolve();
      };
      const onError = (error: Error & { code?: unknown }) => {
        done();
        // MQTT 3.1.1's CONNACK codes 4 (bad user name or password) and 5
        // (not authorised): which one the CC2 sends is to confirm.
        reject(
          error.code === 4 || error.code === 5
            ? new OpenError(
                { kind: "access_code_rejected" },
                "The printer refused the access code.",
                { cause: error },
              )
            : new OpenError({ kind: "unreachable" }, error.message, {
                cause: error,
              }),
        );
      };
      const onClose = () => {
        done();
        reject(
          new OpenError(
            { kind: "unreachable" },
            "The connection closed before the printer accepted it.",
          ),
        );
      };
      client.on("connect", onConnect);
      client.on("error", onError);
      client.on("close", onClose);
    });
  }

  /** Registers this client, and waits for the printer to accept it. */
  async #register(): Promise<void> {
    const topics = this.#topics;
    await this.#client.subscribeAsync(topics.registerResponse, { qos: 1 });
    const answer = new Promise<RegisterResponse>((resolve, reject) => {
      const stop = (error: Error) => {
        clearTimeout(timer);
        this.#registration = null;
        reject(error);
      };
      const timer = setTimeout(() => {
        stop(
          new OpenError(
            { kind: "unreachable" },
            "The printer didn't answer the registration in time.",
          ),
        );
      }, this.#options.registerMs);
      this.#registration = {
        answer: (payload) => {
          const parsed = RegisterResponse.safeParse(payload);
          if (!parsed.success || parsed.data.client_id !== this.clientId) {
            return;
          }
          clearTimeout(timer);
          this.#registration = null;
          resolve(parsed.data);
        },
        cancel: stop,
      };
    });
    await this.#client.publishAsync(
      topics.register,
      JSON.stringify({ client_id: this.clientId, request_id: this.requestId }),
      { qos: 1 },
    );
    const { error } = await answer;
    if (error === "ok") return;
    if (error.toLowerCase().includes("too many clients")) {
      throw new OpenError(
        { kind: "too_many_clients" },
        "The printer has too many clients.",
      );
    }
    throw new OpenError(
      { kind: "register_failed", reason: error },
      `The printer refused the registration: ${error}`,
    );
  }

  #receive(topic: string, payload: Uint8Array): void {
    // Other clients' requests, which the printer may pass on to everyone.
    if (isEcho(topic) || this.#closeReason !== null) return;
    this.#heard();
    const message = parsePayload(payload);
    const topics = this.#topics;

    if (topic === topics.registerResponse) {
      this.#registration?.answer(message);
    } else if (topic === topics.response) {
      if (Pong.safeParse(message).success) return;
      const reply = MethodMessage.safeParse(message);
      if (!reply.success) return;
      const pending = this.#pending.get(reply.data.id);
      this.#pending.delete(reply.data.id);
      pending?.resolve(reply.data);
    } else if (topic === topics.status) {
      const event = MethodMessage.safeParse(message);
      if (event.success) {
        this.#handlers.onStatusEvent(event.data);
      }
    }
  }

  #ping(): void {
    this.#client.publish(this.#topics.request, PING, { qos: 1 });
  }

  /** Restarts the silence clock: the printer has just said something. */
  #heard(): void {
    if (this.#heartbeat === undefined) return;
    clearTimeout(this.#silence);
    this.#silence = setTimeout(() => {
      this.#finish("silent");
      this.#client.end(true);
    }, this.#options.silenceMs);
  }

  /** Stops the clocks, fails what's pending, and records why it closed. */
  #finish(reason: CloseReason): void {
    if (this.#closeReason !== null) return;
    this.#closeReason = reason;
    clearInterval(this.#heartbeat);
    clearTimeout(this.#silence);
    const pending = [...this.#pending.values()];
    this.#pending.clear();
    for (const request of pending) {
      request.reject(new Error("The session closed."));
    }
    this.#registration?.cancel(new Error("The session closed."));
    this.#resolveClosed(reason);
  }

  /** Drops the connection at once, while opening. */
  #drop(): void {
    this.#finish("closed");
    this.#client.end(true);
  }
}
