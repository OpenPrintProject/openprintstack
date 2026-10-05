// SPDX-FileCopyrightText: 2026 Open Print Stack contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { assertSerializable } from "./serializable.ts";
import type { DriverToHostMessage, HostToDriverMessage } from "./wire.ts";

/**
 * One end of the channel between the host and a driver. It behaves like
 * `postMessage`: `send` copies the message synchronously and throws straight
 * away if it can't, and the other end receives it later, in order. Received
 * messages are `unknown`, because the receiver must parse them.
 *
 * In Phase 0 both ends live in one process (`createLoopbackTransport`).
 * Moving drivers to workers only means another implementation of this.
 */
export interface DriverTransport<Outgoing> {
  send(message: Outgoing): void;
  /** Sets the handler for incoming messages. Returns a function removing it. */
  onMessage(handler: (message: unknown) => void): () => void;
  /** Closes both ends. Messages not yet delivered are dropped. */
  close(): void;
}

/** The host's end. */
export type HostTransport = DriverTransport<HostToDriverMessage>;

/** The driver endpoint's end. */
export type DriverSideTransport = DriverTransport<DriverToHostMessage>;

export interface LoopbackOptions {
  /**
   * Whether to copy every message as a worker boundary would: reject anything
   * that isn't `Serializable` (Date, Map, functions, class instances...), then
   * `structuredClone` it. On by default; the plan turns it on in dev and test.
   * Off, messages are passed by reference.
   */
  clone?: boolean;
}

/**
 * A host end and a driver end connected in memory. Messages are delivered in
 * order on a microtask, which Vitest's fake timers leave running by default.
 */
export function createLoopbackTransport(options: LoopbackOptions = {}): {
  host: HostTransport;
  driver: DriverSideTransport;
} {
  const clone = options.clone ?? true;
  let closed = false;
  const handlers = {
    host: new Set<(message: unknown) => void>(),
    driver: new Set<(message: unknown) => void>(),
  };

  function end<Outgoing>(
    own: Set<(message: unknown) => void>,
    other: Set<(message: unknown) => void>,
  ): DriverTransport<Outgoing> {
    return {
      send(message) {
        if (closed) {
          return;
        }
        let copy: unknown = message;
        if (clone) {
          assertSerializable(message);
          copy = structuredClone(message);
        }
        queueMicrotask(() => {
          if (closed) {
            return;
          }
          for (const handler of other) {
            handler(copy);
          }
        });
      },
      onMessage(handler) {
        own.add(handler);
        return () => own.delete(handler);
      },
      close() {
        closed = true;
        handlers.host.clear();
        handlers.driver.clear();
      },
    };
  }

  return {
    host: end<HostToDriverMessage>(handlers.host, handlers.driver),
    driver: end<DriverToHostMessage>(handlers.driver, handlers.host),
  };
}
