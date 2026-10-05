// SPDX-FileCopyrightText: 2026 Open Print Stack contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { PrinterSnapshot } from "@openprintstack/protocol";
import { describe, expectTypeOf, it } from "vitest";

import type { Printer } from "../db/repos/index.ts";
import type { PrinterLookup, StateStore } from "./store.ts";

describe("StateStore", () => {
  it("reads synchronously", () => {
    expectTypeOf<StateStore["get"]>().returns.toEqualTypeOf<
      PrinterSnapshot | undefined
    >();
    expectTypeOf<StateStore["list"]>().returns.toEqualTypeOf<
      PrinterSnapshot[]
    >();
    expectTypeOf<StateStore["seq"]>().toEqualTypeOf<number>();
  });

  it("accepts the printers repo's findById as its lookup", () => {
    expectTypeOf<
      (id: string) => Printer | undefined
    >().toExtend<PrinterLookup>();
  });
});
