// SPDX-FileCopyrightText: 2026 Open Print Stack contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from "vitest";

import { MAX_SKIPS, mergeStatus, StatusFeed } from "./status-feed.ts";

describe("mergeStatus", () => {
  it("merges objects key by key, and replaces everything else", () => {
    const base = {
      machine_status: { status: 2, sub_status: 2075, exception_status: [109] },
      extruder: { temperature: 210, target: 220 },
      fans: { fan: { speed: 255, rpm: 5000 }, aux_fan: { speed: 0 } },
    };

    const merged = mergeStatus(base, {
      machine_status: { sub_status: 2502, exception_status: [] },
      extruder: { temperature: 219.5 },
      fans: { fan: { speed: 128 } },
      led: { status: 0 },
    });

    expect(merged).toEqual({
      machine_status: { status: 2, sub_status: 2502, exception_status: [] },
      extruder: { temperature: 219.5, target: 220 },
      fans: { fan: { speed: 128, rpm: 5000 }, aux_fan: { speed: 0 } },
      led: { status: 0 },
    });
  });

  it("changes neither input", () => {
    const base = { extruder: { temperature: 210 } };
    const delta = { extruder: { target: 220 } };

    mergeStatus(base, delta);

    expect(base).toEqual({ extruder: { temperature: 210 } });
    expect(delta).toEqual({ extruder: { target: 220 } });
  });

  it("replaces an object with a value, and a value with an object", () => {
    expect(
      mergeStatus({ a: { b: 1 }, c: 1 }, { a: null, c: { d: 2 } }),
    ).toEqual({ a: null, c: { d: 2 } });
  });
});

describe("StatusFeed", () => {
  it("merges deltas into the full status", () => {
    const feed = new StatusFeed();
    feed.full({ extruder: { temperature: 25, target: 0 } });

    const result = feed.delta(10, { extruder: { target: 220 } });

    expect(result).toEqual({
      status: { extruder: { temperature: 25, target: 220 } },
      refetch: false,
    });
    expect(feed.status).toEqual(result.status);
  });

  it("ignores deltas before the first full status", () => {
    const feed = new StatusFeed();

    expect(feed.delta(1, { extruder: { target: 220 } })).toEqual({
      status: null,
      refetch: false,
    });
    expect(feed.full({ extruder: { target: 0 } })).toEqual({
      extruder: { target: 0 },
    });
  });

  it("asks for the full status after 5 skipped ids in a row", () => {
    const feed = new StatusFeed();
    feed.full({});
    feed.delta(1, {});

    const refetches = [3, 5, 7, 9, 11].map(
      (id) => feed.delta(id, { id }).refetch,
    );

    expect(MAX_SKIPS).toBe(5);
    expect(refetches).toEqual([false, false, false, false, true]);
    // It merged them all the same.
    expect(feed.status).toEqual({ id: 11 });
  });

  it("starts counting again after a delta that follows on", () => {
    const feed = new StatusFeed();
    feed.full({});
    feed.delta(1, {});

    const refetches = [3, 5, 7, 9, 10, 12, 14, 16, 18, 20].map(
      (id) => feed.delta(id, {}).refetch,
    );

    expect(refetches).toEqual([
      false,
      false,
      false,
      false,
      false, // 10 follows 9: the count starts again
      false,
      false,
      false,
      false,
      true,
    ]);
  });

  it("counts skips from where the count stopped after a refetch", () => {
    const feed = new StatusFeed();
    feed.full({});
    feed.delta(0, {});
    for (const id of [2, 4, 6, 8, 10]) feed.delta(id, {});

    feed.full({ fresh: true });

    expect(feed.delta(11, {}).refetch).toBe(false);
    expect(feed.delta(13, {}).refetch).toBe(false);
  });

  it("forgets everything on reset", () => {
    const feed = new StatusFeed();
    feed.full({ a: 1 });
    feed.delta(1, {});

    feed.reset();

    expect(feed.status).toBeNull();
    // Any id may come first after a reset.
    feed.full({});
    expect(feed.delta(500, {}).refetch).toBe(false);
    expect(feed.delta(501, {}).refetch).toBe(false);
  });
});
