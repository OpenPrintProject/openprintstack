// SPDX-FileCopyrightText: 2026 Open Print Stack contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { z } from "zod";

import type {
  HomeRequest,
  InvokeExtensionRequest,
  ListCamerasResult,
  ListFilesResult,
  MoveRequest,
  PrinterDriver,
  SendFileRequest,
  SetFanRequest,
  SetTemperatureRequest,
  Snapshot,
  SnapshotRequest,
  StartPrintRequest,
} from "./contract.ts";
import { DriverError } from "./errors.ts";
import type { DriverMessage } from "./messages.ts";
import {
  DRIVER_OP_RESULTS,
  type DriverCall,
  type DriverOp,
  type DriverResult,
} from "./ops.ts";
import type { HostTransport } from "./transport.ts";
import { type DriverRequest, DriverToHostEnvelope } from "./wire.ts";

/**
 * Something the driver sent that the host can't accept: a message that fails
 * to parse, an invalid result, or an answer to a request nobody made.
 */
export class DriverProtocolError extends Error {
  override name = "DriverProtocolError";
  /** What arrived, as received. */
  readonly received: unknown;

  constructor(message: string, received: unknown, options?: ErrorOptions) {
    super(message, options);
    this.received = received;
  }
}

export interface DriverClientOptions {
  /** Each valid message the driver emits, in order. */
  onMessage(message: DriverMessage): void;
  /** Each protocol error. The host raises an alert for it. */
  onProtocolError(error: DriverProtocolError): void;
  /** The timeout for calls that don't set their own. Default: none. */
  timeoutMs?: number;
}

export interface CallOptions {
  /** Fails the call with a `timeout` DriverError after this long. */
  timeoutMs?: number;
}

interface Pending {
  op: DriverOp;
  resolve(result: unknown): void;
  reject(error: DriverError): void;
  timer: ReturnType<typeof setTimeout> | undefined;
}

/**
 * The host's side of the transport: a `PrinterDriver` whose methods send
 * requests to the driver endpoint. It parses everything the driver sends with
 * Zod, and turns error responses back into `DriverError`s.
 *
 * The methods use the default timeout; `call` can set one per call.
 */
export class DriverClient implements PrinterDriver {
  readonly #transport: HostTransport;
  readonly #options: DriverClientOptions;
  readonly #pending = new Map<number, Pending>();
  /** Calls that timed out; their late answers are dropped quietly. */
  readonly #timedOut = new Set<number>();
  readonly #unsubscribe: () => void;
  #nextId = 1;
  #closed = false;

  constructor(transport: HostTransport, options: DriverClientOptions) {
    this.#transport = transport;
    this.#options = options;
    this.#unsubscribe = transport.onMessage((raw) => this.#receive(raw));
  }

  call<C extends DriverCall>(
    call: C,
    options: CallOptions = {},
  ): Promise<DriverResult<C["op"]>> {
    const { op, args } = call;
    if (this.#closed) {
      return Promise.reject(
        new DriverError("internal", "The driver connection is closed."),
      );
    }
    const id = this.#nextId++;
    const timeoutMs = options.timeoutMs ?? this.#options.timeoutMs;
    return new Promise((resolve, reject) => {
      const timer =
        timeoutMs === undefined
          ? undefined
          : setTimeout(() => {
              this.#pending.delete(id);
              this.#timedOut.add(id);
              reject(
                new DriverError(
                  "timeout",
                  `The driver didn't answer "${op}" within ${timeoutMs} ms.`,
                ),
              );
            }, timeoutMs);
      this.#pending.set(id, { op, resolve, reject, timer });
      try {
        this.#transport.send({
          type: "request",
          id,
          op,
          args,
        } as DriverRequest);
      } catch (error) {
        const reason = error instanceof Error ? ` ${error.message}` : "";
        this.#take(id)?.reject(
          new DriverError("internal", `Couldn't send "${op}".${reason}`, {
            cause: error,
          }),
        );
      }
    });
  }

  /** Stops listening, closes the transport and fails every pending call. */
  close(): void {
    if (this.#closed) {
      return;
    }
    this.#closed = true;
    this.#unsubscribe();
    this.#transport.close();
    for (const id of [...this.#pending.keys()]) {
      this.#take(id)?.reject(
        new DriverError("internal", "The driver connection closed."),
      );
    }
  }

  #receive(raw: unknown): void {
    const parsed = DriverToHostEnvelope.safeParse(raw);
    if (!parsed.success) {
      this.#protocolError(
        `The driver sent an invalid message. ${z.prettifyError(parsed.error)}`,
        raw,
        parsed.error,
      );
      // If it was meant as an answer, fail that call now instead of letting
      // it time out.
      const id = responseId(raw);
      if (id !== undefined) {
        this.#take(id)?.reject(
          new DriverError("internal", "The driver sent an invalid response."),
        );
      }
      return;
    }
    const message = parsed.data;
    if (message.type === "message") {
      this.#options.onMessage(message.message);
      return;
    }
    const pending = this.#take(message.id);
    if (pending === undefined) {
      if (!this.#timedOut.delete(message.id)) {
        this.#protocolError(
          `The driver answered request ${message.id}, which isn't pending.`,
          raw,
        );
      }
      return;
    }
    if (!message.ok) {
      pending.reject(
        new DriverError(message.error.code, message.error.message),
      );
      return;
    }
    const schema = DRIVER_OP_RESULTS[pending.op];
    if (schema === null) {
      pending.resolve(undefined);
      return;
    }
    const result = schema.safeParse(message.result);
    if (!result.success) {
      const error = new DriverError(
        "internal",
        `The driver returned an invalid result for "${pending.op}".`,
      );
      this.#protocolError(
        `${error.message} ${z.prettifyError(result.error)}`,
        raw,
        result.error,
      );
      pending.reject(error);
      return;
    }
    pending.resolve(result.data);
  }

  /** Removes a pending call and stops its timer. */
  #take(id: number): Pending | undefined {
    const pending = this.#pending.get(id);
    if (pending !== undefined) {
      this.#pending.delete(id);
      clearTimeout(pending.timer);
    }
    return pending;
  }

  #protocolError(message: string, received: unknown, cause?: unknown): void {
    this.#options.onProtocolError(
      new DriverProtocolError(message, received, { cause }),
    );
  }

  connect(): Promise<void> {
    return this.call({ op: "connect", args: {} });
  }

  disconnect(): Promise<void> {
    return this.call({ op: "disconnect", args: {} });
  }

  dispose(): Promise<void> {
    return this.call({ op: "dispose", args: {} });
  }

  listFiles(): Promise<ListFilesResult> {
    return this.call({ op: "listFiles", args: {} });
  }

  sendFile(request: SendFileRequest): Promise<void> {
    return this.call({ op: "sendFile", args: request });
  }

  startPrint(request: StartPrintRequest): Promise<void> {
    return this.call({ op: "startPrint", args: request });
  }

  pause(): Promise<void> {
    return this.call({ op: "pause", args: {} });
  }

  resume(): Promise<void> {
    return this.call({ op: "resume", args: {} });
  }

  cancel(): Promise<void> {
    return this.call({ op: "cancel", args: {} });
  }

  home(request: HomeRequest): Promise<void> {
    return this.call({ op: "home", args: request });
  }

  move(request: MoveRequest): Promise<void> {
    return this.call({ op: "move", args: request });
  }

  setTemperature(request: SetTemperatureRequest): Promise<void> {
    return this.call({ op: "setTemperature", args: request });
  }

  setFan(request: SetFanRequest): Promise<void> {
    return this.call({ op: "setFan", args: request });
  }

  listCameras(): Promise<ListCamerasResult> {
    return this.call({ op: "listCameras", args: {} });
  }

  getSnapshot(request: SnapshotRequest): Promise<Snapshot> {
    return this.call({ op: "getSnapshot", args: request });
  }

  /** Always present; a driver without it answers `not_supported`. */
  invokeExtension(request: InvokeExtensionRequest): Promise<void> {
    return this.call({ op: "invokeExtension", args: request });
  }
}

/** The id of something that looks like a response, even an invalid one. */
function responseId(raw: unknown): number | undefined {
  if (typeof raw !== "object" || raw === null) {
    return undefined;
  }
  const { type, id } = raw as { type?: unknown; id?: unknown };
  return type === "response" && typeof id === "number" ? id : undefined;
}
