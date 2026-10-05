// SPDX-FileCopyrightText: 2026 Open Print Stack contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

// The runtime twin of protocol's `Serializable` type. structuredClone (and so
// postMessage) accepts a Date, Map or Set and turns a class instance into a
// plain object without complaint; only functions and symbols make it throw.
// This check is stricter, so that the cloning transport rejects everything a
// worker boundary or a JSON round trip would change.

/**
 * Describes the first value in `value` that isn't `Serializable`, e.g.
 * `message.detail is a Date`, or returns null if there is none.
 *
 * Allowed: strings, finite numbers, booleans, null, `Uint8Array` (a Node
 * `Buffer` is one, and arrives as a plain `Uint8Array`), arrays, and plain
 * objects whose property values are allowed or `undefined`.
 */
export function findUnserializable(
  value: unknown,
  path = "message",
): string | null {
  return check(value, path, new Set());
}

/** Throws a `TypeError` naming the first value that isn't `Serializable`. */
export function assertSerializable(value: unknown, path = "message"): void {
  const problem = findUnserializable(value, path);
  if (problem !== null) {
    throw new TypeError(`Not serialisable: ${problem}.`);
  }
}

function check(
  value: unknown,
  path: string,
  ancestors: Set<object>,
): string | null {
  switch (typeof value) {
    case "string":
    case "boolean":
      return null;
    case "number":
      return Number.isFinite(value)
        ? null
        : `${path} is ${String(value)}, which JSON can't represent`;
    case "undefined":
      return `${path} is undefined, which is only allowed as an object property`;
    case "bigint":
      return `${path} is a bigint`;
    case "symbol":
      return `${path} is a symbol`;
    case "function":
      return `${path} is a function`;
  }
  if (value === null || value instanceof Uint8Array) {
    return null;
  }
  // typeof value is "object" from here on.
  const object = value as object;
  if (ancestors.has(object)) {
    return `${path} refers back to one of its parents`;
  }
  if (Array.isArray(object)) {
    ancestors.add(object);
    for (const [index, item] of object.entries()) {
      const problem = check(item, `${path}[${index}]`, ancestors);
      if (problem !== null) {
        return problem;
      }
    }
    ancestors.delete(object);
    return null;
  }
  const prototype: unknown = Object.getPrototypeOf(object);
  if (prototype !== Object.prototype && prototype !== null) {
    return `${path} is ${describeInstance(object)}`;
  }
  ancestors.add(object);
  for (const [key, item] of Object.entries(object)) {
    if (item === undefined) {
      continue;
    }
    const problem = check(item, propertyPath(path, key), ancestors);
    if (problem !== null) {
      return problem;
    }
  }
  ancestors.delete(object);
  return null;
}

function describeInstance(object: object): string {
  const name = (object.constructor as { name?: unknown } | undefined)?.name;
  if (typeof name !== "string" || name === "") {
    return "an object with a non-plain prototype";
  }
  return /^[AEIOU]/.test(name) ? `an ${name}` : `a ${name}`;
}

function propertyPath(path: string, key: string): string {
  return /^[A-Za-z_$][\w$]*$/.test(key)
    ? `${path}.${key}`
    : `${path}[${JSON.stringify(key)}]`;
}
