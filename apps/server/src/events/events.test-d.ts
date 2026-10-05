// SPDX-FileCopyrightText: 2026 Open Print Stack contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expectTypeOf, it } from "vitest";

import type { EventPersistence } from "./persistence.ts";
import type { Pruner } from "./pruner.ts";

describe("shutdown", () => {
  it("closes persistence synchronously, like better-sqlite3", () => {
    expectTypeOf<EventPersistence["close"]>().returns.toEqualTypeOf<void>();
  });

  it("starts and stops the pruner asynchronously", () => {
    expectTypeOf<Pruner["start"]>().returns.toEqualTypeOf<Promise<void>>();
    expectTypeOf<Pruner["stop"]>().returns.toEqualTypeOf<Promise<void>>();
  });
});
