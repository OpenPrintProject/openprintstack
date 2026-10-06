// SPDX-FileCopyrightText: 2026 Open Print Stack contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { isIPv4, isIPv6 } from "node:net";

// The login backoff: a basic, in-memory brake on password guessing, per
// client address. Each address gets a few free failures; after that, each
// failure makes it wait twice as long as the last, up to a cap. While it
// waits, logins from it are refused without checking the password, and those
// refusals don't extend the wait. A successful login clears it. Restarting the
// server clears everything.

export type LoginBackoffOptions = {
  /** Failures allowed before any waiting. */
  freeFailures?: number;
  /** The wait after the first failure past the free ones; it then doubles. */
  baseDelayMs?: number;
  /** The longest wait. */
  maxDelayMs?: number;
  /** An address is forgotten this long after its last failure. */
  forgetAfterMs?: number;
  /** The most addresses kept; the one that failed longest ago goes first. */
  maxEntries?: number;
};

export const LOGIN_BACKOFF_DEFAULTS: Required<LoginBackoffOptions> =
  Object.freeze({
    freeFailures: 5,
    baseDelayMs: 1000,
    maxDelayMs: 5 * 60_000,
    forgetAfterMs: 15 * 60_000,
    maxEntries: 10_000,
  });

type Entry = {
  failures: number;
  lastFailureAt: number;
  blockedUntil: number;
};

export class LoginBackoff {
  readonly #options: Required<LoginBackoffOptions>;
  /** In order of last failure, oldest first. */
  readonly #entries = new Map<string, Entry>();

  constructor(options: LoginBackoffOptions = {}) {
    this.#options = { ...LOGIN_BACKOFF_DEFAULTS, ...options };
  }

  /** How many addresses it's keeping. */
  get size(): number {
    return this.#entries.size;
  }

  /** How long `key` must still wait before trying again, or 0. */
  retryAfterMs(key: string, now: number): number {
    const entry = this.#current(key, now);
    return entry === undefined ? 0 : Math.max(0, entry.blockedUntil - now);
  }

  /** Records a failed login from `key`. */
  recordFailure(key: string, now: number): void {
    const failures = (this.#current(key, now)?.failures ?? 0) + 1;
    const { freeFailures, baseDelayMs, maxDelayMs, maxEntries } = this.#options;
    const waits = failures - freeFailures;
    const delay =
      waits > 0 ? Math.min(baseDelayMs * 2 ** (waits - 1), maxDelayMs) : 0;
    // Moved to the end, so the map stays in order of last failure.
    this.#entries.delete(key);
    while (this.#entries.size >= maxEntries) {
      const oldest = this.#entries.keys().next();
      if (oldest.done === true) break;
      this.#entries.delete(oldest.value);
    }
    this.#entries.set(key, {
      failures,
      lastFailureAt: now,
      blockedUntil: now + delay,
    });
  }

  /** Records a successful login from `key`, clearing its failures. */
  recordSuccess(key: string): void {
    this.#entries.delete(key);
  }

  /** The entry for `key`, unless it's old enough to forget. */
  #current(key: string, now: number): Entry | undefined {
    const entry = this.#entries.get(key);
    if (
      entry !== undefined &&
      now - entry.lastFailureAt >= this.#options.forgetAfterMs
    ) {
      this.#entries.delete(key);
      return undefined;
    }
    return entry;
  }
}

/**
 * The backoff key for a client address. IPv4-mapped IPv6 addresses count as
 * IPv4, and other IPv6 addresses by their /64 prefix, since one machine can
 * have any address in its /64. An unknown address is "unknown".
 */
export function clientKey(address: string | null | undefined): string {
  if (address === undefined || address === null || address === "") {
    return "unknown";
  }
  const withoutZone = address.replace(/%.*$/, "");
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(withoutZone)?.[1];
  if (mapped !== undefined && isIPv4(mapped)) return mapped;
  if (isIPv6(withoutZone)) {
    return `${expandIPv6(withoutZone).slice(0, 4).join(":")}::/64`;
  }
  return withoutZone.toLowerCase();
}

/** The eight 16-bit groups of an IPv6 address, as lowercase hex. */
function expandIPv6(address: string): string[] {
  let text = address.toLowerCase();
  // A trailing IPv4 part ("::1.2.3.4") becomes two groups.
  const v4 = /(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(text);
  if (v4 !== null) {
    const [a, b, c, d] = v4.slice(1).map(Number) as [
      number,
      number,
      number,
      number,
    ];
    text = `${text.slice(0, v4.index)}${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
  }
  const [head = "", tail] = text.split("::");
  const left = head === "" ? [] : head.split(":");
  const right = tail === undefined || tail === "" ? [] : tail.split(":");
  const missing = tail === undefined ? 0 : 8 - left.length - right.length;
  return [...left, ...Array<string>(missing).fill("0"), ...right].map((group) =>
    Number.parseInt(group, 16).toString(16),
  );
}
