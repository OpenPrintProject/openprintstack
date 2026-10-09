// SPDX-FileCopyrightText: 2026 Open Print Stack contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { JsonObject } from "./protocol.ts";

// The printer's status as one object: the full status (method 1002) with every
// delta (event 6000) merged in. Deltas carry only what changed, and each has
// the next id in the printer's own sequence. A delta that doesn't follow the
// last one means some were missed; after 5 in a row, the merged status can't
// be trusted, so it's time to ask for the full status again.

/** How many skipped ids in a row call for the full status again. */
export const MAX_SKIPS = 5;

/**
 * Merges `delta` into `base` without changing either: objects merge key by
 * key, and anything else (numbers, strings, arrays such as
 * `exception_status`) replaces what was there.
 */
export function mergeStatus(base: JsonObject, delta: JsonObject): JsonObject {
  const merged: JsonObject = { ...base };
  for (const [key, value] of Object.entries(delta)) {
    const current = merged[key];
    merged[key] =
      isObject(value) && isObject(current)
        ? mergeStatus(current, value)
        : value;
  }
  return merged;
}

export type DeltaResult = {
  /** The merged status, or null if there's no full status to merge into. */
  readonly status: JsonObject | null;
  /** Whether to ask for the full status again. */
  readonly refetch: boolean;
};

export class StatusFeed {
  #status: JsonObject | null = null;
  #lastId: number | null = null;
  #skips = 0;

  /** The merged status, or null before the first full status. */
  get status(): JsonObject | null {
    return this.#status;
  }

  /** Replaces everything with a full status. */
  full(result: JsonObject): JsonObject {
    this.#status = result;
    this.#skips = 0;
    return result;
  }

  /**
   * Merges a delta. Its id is checked even before the first full status, so
   * the sequence is known by the time it arrives.
   */
  delta(id: number, result: JsonObject): DeltaResult {
    let refetch = false;
    if (this.#lastId !== null && id !== this.#lastId + 1) {
      this.#skips += 1;
      if (this.#skips >= MAX_SKIPS) {
        this.#skips = 0;
        refetch = true;
      }
    } else {
      this.#skips = 0;
    }
    this.#lastId = id;

    if (this.#status === null) {
      return { status: null, refetch };
    }
    this.#status = mergeStatus(this.#status, result);
    return { status: this.#status, refetch };
  }

  /** Forgets everything, e.g. when the connection drops. */
  reset(): void {
    this.#status = null;
    this.#lastId = null;
    this.#skips = 0;
  }
}

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
