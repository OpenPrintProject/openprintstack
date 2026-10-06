// SPDX-FileCopyrightText: 2026 Open Print Stack contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { DriverCall } from "@openprintstack/driver-sdk";
import { describe, expectTypeOf, it } from "vitest";

import type { PrinterService } from "../printers/printer-service.ts";
import type { DriverHost, HostCall } from "./host.ts";
import type { DRIVER_SOURCES, DriverSource } from "./registry.ts";

declare const service: PrinterService;

describe("HostCall", () => {
  it("is every driver call except connecting and stopping", () => {
    expectTypeOf<HostCall["op"]>().toEqualTypeOf<
      Exclude<DriverCall["op"], "connect" | "disconnect" | "dispose">
    >();
  });

  it("keeps commands and reads from connecting or stopping a driver", () => {
    // @ts-expect-error Only the host connects.
    void service.call("p", { op: "connect", args: {} }, 1);
    // @ts-expect-error Only the host disposes.
    void service.call("p", { op: "dispose", args: {} }, 1);
    void service.call("p", { op: "pause", args: {} }, 1);
  });

  it("resolves with the op's result", () => {
    expectTypeOf(
      service.call("p", { op: "listFiles", args: {} }, 1),
    ).resolves.toHaveProperty("files");
    expectTypeOf<ReturnType<DriverHost["call"]>>().resolves.not.toBeNever();
  });
});

describe("DRIVER_SOURCES", () => {
  it("are driver sources", () => {
    expectTypeOf<
      (typeof DRIVER_SOURCES)[keyof typeof DRIVER_SOURCES]
    >().toExtend<DriverSource>();
  });
});
