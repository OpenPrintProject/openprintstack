// SPDX-FileCopyrightText: 2026 Open Print Stack contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { createSocket } from "node:dgram";
import { isIPv6 } from "node:net";

import { DISCOVERY_QUERY, DiscoveryReply, parsePayload } from "./protocol.ts";

// Every MQTT topic names the printer's serial number, which the add form
// doesn't ask for. The printer gives it, by UDP, to anyone who asks.

export type PrinterIdentity = {
  readonly serial: string;
  /** The name set on the printer, if it says. */
  readonly name: string | null;
  readonly model: string | null;
  /** Whether LAN Only mode is on, or null if it doesn't say. */
  readonly lanOnly: boolean | null;
  /** Whether an access code is set, or null if it doesn't say. */
  readonly accessCodeSet: boolean | null;
};

export type IdentifyOptions = {
  /** How long to wait for an answer. */
  readonly timeoutMs: number;
  /** How often to ask again meanwhile, as UDP may drop the query. */
  readonly retryMs: number;
  readonly signal?: AbortSignal;
};

/**
 * Asks the printer at `host` for its serial number. Resolves with null if it
 * doesn't answer in time, including when the address doesn't resolve.
 * Rejects only if `signal` aborts.
 */
export function identifyPrinter(
  host: string,
  port: number,
  { timeoutMs, retryMs, signal }: IdentifyOptions,
): Promise<PrinterIdentity | null> {
  return new Promise((resolve, reject) => {
    signal?.throwIfAborted();
    const socket = createSocket(isIPv6(host) ? "udp6" : "udp4");
    const query = Buffer.from(DISCOVERY_QUERY);

    const stop = () => {
      clearInterval(retry);
      clearTimeout(timeout);
      signal?.removeEventListener("abort", abort);
      socket.close();
    };
    const finish = (identity: PrinterIdentity | null) => {
      stop();
      resolve(identity);
    };
    const abort = () => {
      stop();
      reject(signal?.reason as Error);
    };
    const send = () => {
      // A send that fails (e.g. no route yet) is tried again on the next tick.
      socket.send(query, port, host, () => undefined);
    };

    socket.on("message", (message) => {
      const reply = DiscoveryReply.safeParse(parsePayload(message));
      if (!reply.success) return;
      const { sn, host_name, machine_model, lan_status, token_status } =
        reply.data.result;
      finish({
        serial: sn,
        name: host_name ?? null,
        model: machine_model ?? null,
        lanOnly: lan_status === undefined ? null : lan_status === 1,
        accessCodeSet: token_status === undefined ? null : token_status === 1,
      });
    });
    // E.g. an ICMP "port unreachable" on some platforms. Keep waiting.
    socket.on("error", () => undefined);

    const retry = setInterval(send, retryMs);
    const timeout = setTimeout(() => finish(null), timeoutMs);
    signal?.addEventListener("abort", abort, { once: true });
    send();
  });
}
