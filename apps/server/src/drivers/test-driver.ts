// SPDX-FileCopyrightText: 2026 Open Print Stack contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

// A driver for the server's tests: it records every call and does whatever
// each test tells it to. Not used by the server itself.

import {
  defineDriver,
  type DriverContext,
  type DriverInit,
  type DriverMessage,
  type DriverOp,
  type HomeRequest,
  type InvokeExtensionRequest,
  type ListCamerasResult,
  type ListFilesResult,
  type MoveRequest,
  type PrinterDriver,
  type SendFileRequest,
  type SetFanRequest,
  type SetTemperatureRequest,
  type Snapshot,
  type SnapshotRequest,
  type StartPrintRequest,
} from "@openprintstack/driver-sdk";
import {
  type Capabilities,
  CommandKind,
  type PrinterStatus,
} from "@openprintstack/protocol";
import { z } from "zod";

import { DRIVER_SOURCES, DriverRegistry } from "./registry.ts";

export const TEST_DRIVER_TYPE = "test";

export const testSettingsSchema = z.object({
  nozzleMaxC: z.number().min(1).default(250),
  /** Makes `create` throw. */
  failCreate: z.boolean().default(false),
  /** A secret, as a real printer's access code is. */
  accessCode: z.string().optional().meta({ writeOnly: true }),
});

export type TestSettings = z.output<typeof testSettingsSchema>;

/** Everything a command can use: a nozzle, a bed, two fans, 200 mm axes. */
export function testCapabilities(settings: TestSettings): Capabilities {
  return {
    commands: [...CommandKind.options],
    heaters: [
      {
        id: "nozzle",
        kind: "nozzle",
        label: "Nozzle",
        maxC: settings.nozzleMaxC,
      },
      { id: "bed", kind: "bed", label: "Bed", maxC: 100 },
    ],
    fans: [
      { id: "part", kind: "part", label: "Part cooling", controllable: true },
      { id: "hotend", kind: "other", label: "Hotend", controllable: false },
    ],
    axes: {
      x: { minMm: 0, maxMm: 200 },
      y: { minMm: 0, maxMm: 200 },
      z: { minMm: 0, maxMm: 180 },
    },
    maxMoveSpeedMmS: 150,
    files: {
      list: true,
      upload: true,
      acceptedExtensions: [".gcode"],
      maxUploadBytes: 1000,
    },
    cameras: { snapshot: true, stream: false },
    extensions: ["test"],
  };
}

/** What a call does. It may return a promise, or throw. */
export type Handler = (args: unknown, driver: TestDriver) => unknown;

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function status(status: PrinterStatus): DriverMessage {
  return { type: "status", status, detail: null, error: null };
}

/** By default it connects as idle, disconnects as offline, and succeeds. */
const DEFAULT_HANDLERS: Partial<Record<DriverOp, Handler>> = {
  connect: (_, driver) => driver.emit(status("idle")),
  disconnect: (_, driver) => driver.emit(status("offline")),
  listFiles: (): ListFilesResult => ({ files: [] }),
  listCameras: (): ListCamerasResult => ({ cameras: [] }),
  getSnapshot: (): Snapshot => ({ mimeType: "image/png", data: PNG }),
};

export class TestDriver implements PrinterDriver {
  readonly init: DriverInit<TestSettings>;
  /** Every call, in the order they arrived. */
  readonly calls: { op: DriverOp; args: unknown }[] = [];
  disposed = false;
  readonly #ctx: DriverContext;
  readonly #handlers: Map<DriverOp, Handler>;

  constructor(
    init: DriverInit<TestSettings>,
    ctx: DriverContext,
    handlers: Map<DriverOp, Handler>,
  ) {
    this.init = init;
    this.#ctx = ctx;
    this.#handlers = handlers;
  }

  /** Makes every later call of `op` run `handler`. */
  handle(op: DriverOp, handler: Handler): void {
    this.#handlers.set(op, handler);
  }

  emit(message: DriverMessage): void {
    this.#ctx.emit(message);
  }

  /** Emits anything at all, so tests can send what a broken driver would. */
  emitUnchecked(message: unknown): void {
    this.#ctx.emit(message as DriverMessage);
  }

  /** The ops called so far, in order. */
  ops(): DriverOp[] {
    return this.calls.map((call) => call.op);
  }

  #call<T>(op: DriverOp, args: unknown): Promise<T> {
    this.calls.push({ op, args });
    const handler = this.#handlers.get(op) ?? DEFAULT_HANDLERS[op];
    return new Promise((resolve) => resolve(handler?.(args, this) as T));
  }

  connect(): Promise<void> {
    return this.#call("connect", {});
  }

  disconnect(): Promise<void> {
    return this.#call("disconnect", {});
  }

  dispose(): Promise<void> {
    this.disposed = true;
    return this.#call("dispose", {});
  }

  listFiles(): Promise<ListFilesResult> {
    return this.#call("listFiles", {});
  }

  sendFile(request: SendFileRequest): Promise<void> {
    return this.#call("sendFile", request);
  }

  startPrint(request: StartPrintRequest): Promise<void> {
    return this.#call("startPrint", request);
  }

  pause(): Promise<void> {
    return this.#call("pause", {});
  }

  resume(): Promise<void> {
    return this.#call("resume", {});
  }

  cancel(): Promise<void> {
    return this.#call("cancel", {});
  }

  home(request: HomeRequest): Promise<void> {
    return this.#call("home", request);
  }

  move(request: MoveRequest): Promise<void> {
    return this.#call("move", request);
  }

  setTemperature(request: SetTemperatureRequest): Promise<void> {
    return this.#call("setTemperature", request);
  }

  setFan(request: SetFanRequest): Promise<void> {
    return this.#call("setFan", request);
  }

  listCameras(): Promise<ListCamerasResult> {
    return this.#call("listCameras", {});
  }

  getSnapshot(request: SnapshotRequest): Promise<Snapshot> {
    return this.#call("getSnapshot", request);
  }

  invokeExtension(request: InvokeExtensionRequest): Promise<void> {
    return this.#call("invokeExtension", request);
  }
}

/** The test driver's module, and every driver it has created. */
export class TestDrivers {
  readonly created: TestDriver[] = [];
  readonly #handlers = new Map<DriverOp, Handler>();

  readonly module = defineDriver({
    manifest: {
      type: TEST_DRIVER_TYPE,
      name: "Test printer",
      description: "A driver that does what the test tells it.",
    },
    settingsSchema: testSettingsSchema,
    initialCapabilities: testCapabilities,
    create: (init, ctx) => {
      if (init.settings.failCreate) {
        throw new Error("The test driver was told not to start.");
      }
      const driver = new TestDriver(init, ctx, new Map(this.#handlers));
      this.created.push(driver);
      return driver;
    },
  });

  /** Makes every driver created from now on run `handler` for `op`. */
  handle(op: DriverOp, handler: Handler): void {
    this.#handlers.set(op, handler);
  }

  /** The newest driver created for the printer. */
  latest(printerId: string): TestDriver {
    const driver = this.created.findLast(
      (candidate) => candidate.init.printerId === printerId,
    );
    if (driver === undefined) {
      throw new Error(`No test driver was created for ${printerId}.`);
    }
    return driver;
  }
}

/** A registry with the test driver as `test`, plus the real `simulated`. */
export function testRegistry(drivers: TestDrivers): DriverRegistry {
  return new DriverRegistry({
    [TEST_DRIVER_TYPE]: {
      specifier: "test-driver",
      load: () => Promise.resolve({ default: drivers.module }),
    },
    simulated: DRIVER_SOURCES.simulated,
  });
}
