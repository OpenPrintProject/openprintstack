// SPDX-FileCopyrightText: 2026 Open Print Stack contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * A value that can cross a process or worker boundary unchanged: it survives
 * `structuredClone` (and so `postMessage`) and, apart from `Uint8Array`, a JSON
 * round trip. No `Date`, `Map`, `Set`, class instances or functions; timestamps
 * are ISO strings. `undefined` is only allowed for optional object properties.
 */
export type Serializable =
  | string
  | number
  | boolean
  | null
  | Uint8Array
  | readonly Serializable[]
  | { readonly [key: string]: Serializable | undefined };
