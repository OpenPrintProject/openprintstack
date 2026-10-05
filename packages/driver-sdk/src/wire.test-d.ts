// SPDX-FileCopyrightText: 2026 Open Print Stack contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

// Type tests: Vitest runs these through tsc (see vitest.config.ts).

import type {
  PrinterCommandOf,
  Serializable,
  Telemetry,
} from "@openprintstack/protocol";
import { describe, expectTypeOf, it } from "vitest";
import type { z } from "zod";

import type { fakeSettingsSchema } from "./fake-driver.ts";
import type {
  DriverArgs,
  DriverCall,
  DriverEmit,
  DriverErrorInfo,
  DriverInit,
  DriverManifest,
  DriverMessage,
  DriverOp,
  DriverRequest,
  DriverResponse,
  DriverResult,
  DriverToHostMessage,
  EmptyArgs,
  HostToDriverMessage,
  ListFilesResult,
  PrinterDriver,
  SendFileRequest,
  SetFanRequest,
  Snapshot,
  TelemetryPatch,
  WireResult,
} from "./index.ts";
import type { DRIVER_OPS } from "./index.ts";

describe("Serializable", () => {
  it("accepts every host↔driver wire message", () => {
    // A union extends Serializable only if every member does, so these cover
    // each op's request and response and each driver message type.
    expectTypeOf<HostToDriverMessage>().toExtend<Serializable>();
    expectTypeOf<DriverToHostMessage>().toExtend<Serializable>();
    expectTypeOf<DriverRequest>().toExtend<Serializable>();
    expectTypeOf<DriverResponse>().toExtend<Serializable>();
    expectTypeOf<DriverEmit>().toExtend<Serializable>();
    expectTypeOf<DriverMessage>().toExtend<Serializable>();
    expectTypeOf<DriverErrorInfo>().toExtend<Serializable>();
  });

  it("accepts every op's args and wire result", () => {
    expectTypeOf<
      { [Op in DriverOp]: DriverArgs<Op> }[DriverOp]
    >().toExtend<Serializable>();
    expectTypeOf<
      { [Op in DriverOp]: WireResult<Op> }[DriverOp]
    >().toExtend<Serializable>();
  });

  it("accepts the data a driver is created with", () => {
    expectTypeOf<
      DriverInit<z.output<typeof fakeSettingsSchema>>
    >().toExtend<Serializable>();
    expectTypeOf<DriverManifest>().toExtend<Serializable>();
  });

  it("rejects a message holding a Date or a function", () => {
    expectTypeOf<{
      type: "status";
      status: "idle";
      detail: Date;
      error: null;
    }>().not.toExtend<DriverMessage>();
    expectTypeOf<{
      type: "log";
      level: "info";
      message: string;
      data: { onDone: () => void };
    }>().not.toExtend<DriverMessage>();
  });
});

describe("ops", () => {
  it("are exactly the PrinterDriver methods", () => {
    expectTypeOf<(typeof DRIVER_OPS)[number]>().toEqualTypeOf<
      keyof PrinterDriver
    >();
  });

  it("take their request, or {} when the method takes none", () => {
    expectTypeOf<DriverArgs<"setFan">>().toEqualTypeOf<SetFanRequest>();
    expectTypeOf<DriverArgs<"sendFile">>().toEqualTypeOf<SendFileRequest>();
    expectTypeOf<DriverArgs<"pause">>().toEqualTypeOf<EmptyArgs>();
    expectTypeOf<
      Extract<DriverCall, { op: "setFan" }>["args"]
    >().toEqualTypeOf<SetFanRequest>();
  });

  it("answer their result, or null when they resolve with nothing", () => {
    expectTypeOf<DriverResult<"listFiles">>().toEqualTypeOf<ListFilesResult>();
    expectTypeOf<WireResult<"listFiles">>().toEqualTypeOf<ListFilesResult>();
    expectTypeOf<DriverResult<"pause">>().toEqualTypeOf<void>();
    expectTypeOf<WireResult<"pause">>().toEqualTypeOf<null>();
    expectTypeOf<WireResult<"invokeExtension">>().toEqualTypeOf<null>();
  });

  it("reuse protocol's command shapes for command requests", () => {
    expectTypeOf<DriverArgs<"move">>().toEqualTypeOf<
      Omit<PrinterCommandOf<"motion.move">, "kind">
    >();
    expectTypeOf<SetFanRequest>().toEqualTypeOf<
      Omit<PrinterCommandOf<"fan.set">, "kind">
    >();
  });
});

describe("telemetry patches", () => {
  it("can set every field but job, which the job message sets", () => {
    expectTypeOf<keyof TelemetryPatch>().toEqualTypeOf<
      Exclude<keyof Telemetry, "job">
    >();
  });
});

describe("snapshots", () => {
  it("carry bytes as a Uint8Array", () => {
    expectTypeOf<Snapshot["data"]>().toEqualTypeOf<Uint8Array>();
    expectTypeOf<Buffer>().toExtend<Snapshot["data"]>();
  });
});
