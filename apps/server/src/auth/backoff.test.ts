// SPDX-FileCopyrightText: 2026 Open Print Stack contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from "vitest";

import { clientKey, LOGIN_BACKOFF_DEFAULTS, LoginBackoff } from "./backoff.ts";

const MINUTE = 60_000;

/** Fails `count` times at `now`, waiting out each wait first. */
function failTimes(backoff: LoginBackoff, key: string, count: number) {
  let now = 0;
  for (let i = 0; i < count; i++) {
    now += backoff.retryAfterMs(key, now);
    backoff.recordFailure(key, now);
  }
  return now;
}

describe("LOGIN_BACKOFF_DEFAULTS", () => {
  it("are 5 free failures, then 1 s doubling to 5 min, forgotten after 15 min, 10,000 addresses", () => {
    expect(LOGIN_BACKOFF_DEFAULTS).toEqual({
      freeFailures: 5,
      baseDelayMs: 1000,
      maxDelayMs: 5 * MINUTE,
      forgetAfterMs: 15 * MINUTE,
      maxEntries: 10_000,
    });
  });
});

describe("LoginBackoff", () => {
  it("lets the first 5 failures through without waiting", () => {
    const backoff = new LoginBackoff();

    for (let i = 1; i <= 5; i++) {
      backoff.recordFailure("a", 0);
      expect(backoff.retryAfterMs("a", 0), `after ${i}`).toBe(0);
    }
  });

  it("waits 1 s after the 6th failure, doubling each time, up to 5 min", () => {
    const backoff = new LoginBackoff();
    const waits: number[] = [];
    let now = failTimes(backoff, "a", 5);

    for (let i = 6; i <= 16; i++) {
      backoff.recordFailure("a", now);
      const wait = backoff.retryAfterMs("a", now);
      waits.push(wait);
      now += wait;
    }

    expect(waits).toEqual([
      1000, 2000, 4000, 8000, 16_000, 32_000, 64_000, 128_000, 256_000, 300_000,
      300_000,
    ]);
  });

  it("counts the wait down, and lets the address try again when it's over", () => {
    const backoff = new LoginBackoff();
    const now = failTimes(backoff, "a", 7);

    expect(backoff.retryAfterMs("a", now)).toBe(2000);
    expect(backoff.retryAfterMs("a", now + 1500)).toBe(500);
    expect(backoff.retryAfterMs("a", now + 1999)).toBe(1);
    expect(backoff.retryAfterMs("a", now + 2000)).toBe(0);
  });

  it("doesn't extend the wait when an address only asks", () => {
    const backoff = new LoginBackoff();
    const now = failTimes(backoff, "a", 6);

    for (let t = 0; t < 1000; t += 100) {
      backoff.retryAfterMs("a", now + t);
    }

    expect(backoff.retryAfterMs("a", now + 1000)).toBe(0);
  });

  it("clears an address's failures when it logs in", () => {
    const backoff = new LoginBackoff();
    const now = failTimes(backoff, "a", 8);

    backoff.recordSuccess("a");

    expect(backoff.retryAfterMs("a", now)).toBe(0);
    for (let i = 0; i < 5; i++) backoff.recordFailure("a", now);
    expect(backoff.retryAfterMs("a", now)).toBe(0);
  });

  it("keeps addresses apart", () => {
    const backoff = new LoginBackoff();
    const now = failTimes(backoff, "a", 6);

    expect(backoff.retryAfterMs("b", now)).toBe(0);
  });

  it("forgets an address 15 minutes after its last failure", () => {
    const backoff = new LoginBackoff();
    const last = failTimes(backoff, "a", 5);

    // One minute short, the failures still count: a 6th means waiting.
    const early = new LoginBackoff();
    failTimes(early, "a", 5);
    early.recordFailure("a", last + 15 * MINUTE - 1);
    expect(early.retryAfterMs("a", last + 15 * MINUTE - 1)).toBe(1000);

    // Exactly 15 minutes later they're forgotten: this is a first failure.
    backoff.recordFailure("a", last + 15 * MINUTE);
    expect(backoff.retryAfterMs("a", last + 15 * MINUTE)).toBe(0);
    expect(backoff.size).toBe(1);
  });

  it("keeps at most maxEntries addresses, dropping the one that failed longest ago", () => {
    const backoff = new LoginBackoff({ maxEntries: 3, freeFailures: 0 });
    backoff.recordFailure("a", 0);
    backoff.recordFailure("b", 1);
    backoff.recordFailure("c", 2);
    // a fails again, so b is now the oldest.
    backoff.recordFailure("a", 3);

    backoff.recordFailure("d", 4);

    expect(backoff.size).toBe(3);
    expect(backoff.retryAfterMs("b", 4)).toBe(0);
    expect(backoff.retryAfterMs("a", 4)).toBeGreaterThan(0);
    expect(backoff.retryAfterMs("c", 4)).toBeGreaterThan(0);
    expect(backoff.retryAfterMs("d", 4)).toBeGreaterThan(0);
  });
});

describe("clientKey", () => {
  it.each([
    ["an IPv4 address", "192.168.1.20", "192.168.1.20"],
    ["an IPv4-mapped IPv6 address", "::ffff:127.0.0.1", "127.0.0.1"],
    ["one in capitals", "::FFFF:10.0.0.1", "10.0.0.1"],
    ["IPv6 by its /64", "2001:db8:1:2:3:4:5:6", "2001:db8:1:2::/64"],
    ["another address in that /64", "2001:db8:1:2::9", "2001:db8:1:2::/64"],
    ["IPv6 with leading zeros", "2001:0db8:0001:0002::1", "2001:db8:1:2::/64"],
    ["IPv6 loopback", "::1", "0:0:0:0::/64"],
    ["a link-local address with a zone", "fe80::1%en0", "fe80:0:0:0::/64"],
    ["IPv6 ending in IPv4", "64:ff9b::192.0.2.1", "64:ff9b:0:0::/64"],
    ["no address", undefined, "unknown"],
    ["a null address", null, "unknown"],
    ["an empty address", "", "unknown"],
  ])("keys %s", (_, address, key) => {
    expect(clientKey(address)).toBe(key);
  });

  it("puts another /64 under another key", () => {
    expect(clientKey("2001:db8:1:3::1")).not.toBe(clientKey("2001:db8:1:2::1"));
  });
});
