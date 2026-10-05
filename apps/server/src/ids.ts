// SPDX-FileCopyrightText: 2026 Open Print Stack contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { randomUUIDv7 } from "node:crypto";

/**
 * A new UUIDv7 for a user, printer, event, boot or command. The first 48 bits
 * are the time in milliseconds, so ids roughly sort by creation time, but two
 * made in the same millisecond may not. Nothing relies on that order: events
 * are ordered by `seq` and `row_id`.
 */
export function newId(): string {
  return randomUUIDv7();
}
