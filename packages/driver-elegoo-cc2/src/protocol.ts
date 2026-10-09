// SPDX-FileCopyrightText: 2026 Open Print Stack contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { z } from "zod";

// The CC2's wire facts: ports, topics, methods and message shapes. Elegoo
// hasn't published them; they're drawn from Elegoo's own client library
// (elegoo-link, Apache-2.0) and the Home Assistant integration's protocol
// notes (CC2_PROTOCOL.md, MIT). No code was copied from either.

/** The printer's MQTT broker (plain TCP). */
export const MQTT_PORT = 1883;

/** Where the printer answers the serial-number query. */
export const DISCOVERY_PORT = 52700;

/** Every client logs in as this user; the password is the access code. */
export const MQTT_USERNAME = "elegoo";

export const METHOD = {
  /** The full status, in reply to a request. */
  getStatus: 1002,
  /** A file's details, including its layer count. */
  getFileDetail: 1046,
  /** A status delta the printer pushes about once a second. */
  statusEvent: 6000,
  /** The serial-number query, sent by UDP. */
  discovery: 7000,
} as const;

/** The query the printer answers with its serial number, by UDP. */
export const DISCOVERY_QUERY = JSON.stringify({
  id: 0,
  method: METHOD.discovery,
});

/** The MQTT topics one client uses. */
export type Topics = {
  /** Where a client asks to register. */
  readonly register: string;
  /** Where the printer answers this client's registration. */
  readonly registerResponse: string;
  /** Status deltas, for every client. */
  readonly status: string;
  /** Where this client sends requests and PINGs. */
  readonly request: string;
  /** Where the printer answers this client's requests and PINGs. */
  readonly response: string;
};

export function topicsFor(
  serial: string,
  clientId: string,
  requestId: string,
): Topics {
  const base = `elegoo/${serial}`;
  return {
    register: `${base}/api_register`,
    registerResponse: `${base}/${requestId}/register_response`,
    status: `${base}/api_status`,
    request: `${base}/${clientId}/api_request`,
    response: `${base}/${clientId}/api_response`,
  };
}

/**
 * Whether a message is another client's request or registration, which the
 * printer may pass on to every client. They're never for us.
 */
export function isEcho(topic: string): boolean {
  return topic.endsWith("/api_request") || topic.endsWith("/api_register");
}

/**
 * A client id in the format of the printer's own web page: "0cli", the last
 * five hex digits of the time in milliseconds, then random hex digits, ten
 * characters in all. Built from the clock, so it's very unlikely to clash
 * with another client's.
 */
export function newClientId(now = Date.now(), random = Math.random): string {
  const time = now.toString(16).slice(-5).padStart(5, "0");
  const noise = Math.floor(random() * 0x1000)
    .toString(16)
    .padStart(3, "0");
  return `0cli${time}${noise}`.slice(0, 10);
}

/**
 * A registration request id in the web page's format: 16 random hex digits,
 * then the time in milliseconds in hex.
 */
export function newRequestId(now = Date.now(), random = Math.random): string {
  let noise = "";
  for (let i = 0; i < 16; i++) {
    noise += Math.floor(random() * 16).toString(16);
  }
  return `${noise}${now.toString(16)}`;
}

/** The heartbeat. The printer answers `{"type":"PONG"}`. */
export const PING = JSON.stringify({ type: "PING" });

/** A JSON object, as the printer sends its status. */
export type JsonObject = { [key: string]: unknown };

const JsonObject = z.record(z.string(), z.unknown());

/** The answer to the serial-number query. */
export const DiscoveryReply = z.object({
  result: z.object({
    sn: z.string().min(1),
    host_name: z.string().optional(),
    machine_model: z.string().optional(),
    /** 1 once an access code is set on the printer. */
    token_status: z.number().optional(),
    /** 1 in LAN Only mode. */
    lan_status: z.number().optional(),
  }),
});

/** The answer to a registration: `error` is "ok" on success. */
export const RegisterResponse = z.object({
  client_id: z.string(),
  error: z.string(),
});

export type RegisterResponse = z.infer<typeof RegisterResponse>;

/** The answer to a PING. */
export const Pong = z.object({ type: z.literal("PONG") });

/**
 * A reply to a request (on the client's response topic), or a status delta
 * (method 6000, on the status topic). `id` matches the request's, or is the
 * delta's place in the printer's own sequence.
 */
export const MethodMessage = z.object({
  id: z.number(),
  method: z.number(),
  result: JsonObject,
});

export type MethodMessage = z.infer<typeof MethodMessage>;

/** Reads a message's payload as JSON, or undefined if it isn't JSON. */
export function parsePayload(payload: Uint8Array | string): unknown {
  try {
    return JSON.parse(
      typeof payload === "string" ? payload : new TextDecoder().decode(payload),
    ) as unknown;
  } catch {
    return undefined;
  }
}
