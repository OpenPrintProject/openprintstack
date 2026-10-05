// SPDX-FileCopyrightText: 2026 Open Print Stack contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

// A small in-memory driver for driver-sdk's own tests. It implements the whole
// contract, so it passes the conformance kit; `patchFakeDriver` breaks it on
// purpose. It isn't exported from the package.

import { readFile } from "node:fs/promises";

import type {
  Axis,
  Capabilities,
  PrinterFile,
  PrinterStatus,
} from "@openprintstack/protocol";
import { z } from "zod";

import {
  defineDriver,
  type DriverContext,
  type DriverInit,
  type DriverModule,
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
} from "./contract.ts";
import { DriverError } from "./errors.ts";
import { DRIVER_OPS } from "./ops.ts";

export const fakeSettingsSchema = z.object({
  /** How often it reports telemetry while connected. */
  tickMs: z.number().positive().default(20),
  cameraEnabled: z.boolean().default(true),
  /** When false, connect reports offline and keeps retrying. */
  reachable: z.boolean().default(true),
});

type FakeSettings = z.output<typeof fakeSettingsSchema>;

/** The PNG signature: enough bytes for a fake snapshot. */
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function fakeCapabilities(settings: FakeSettings): Capabilities {
  return {
    commands: [
      "print.start",
      "print.pause",
      "print.resume",
      "print.cancel",
      "motion.home",
      "motion.move",
      "temperature.set",
      "fan.set",
      "file.upload",
      "extension.invoke",
    ],
    heaters: [{ id: "nozzle", kind: "nozzle", label: "Nozzle", maxC: 300 }],
    fans: [
      { id: "part", kind: "part", label: "Part cooling", controllable: true },
    ],
    axes: {
      x: { minMm: 0, maxMm: 200 },
      y: { minMm: 0, maxMm: 200 },
      z: { minMm: 0, maxMm: 200 },
    },
    maxMoveSpeedMmS: 100,
    files: {
      list: true,
      upload: true,
      acceptedExtensions: [".gcode"],
      maxUploadBytes: null,
    },
    cameras: { snapshot: settings.cameraEnabled, stream: false },
    extensions: ["fake"],
  };
}

/** Runs a synchronous step as an async method would: a throw rejects. */
function run(step: () => void): Promise<void> {
  return new Promise((resolve) => {
    step();
    resolve();
  });
}

class FakeDriver implements PrinterDriver {
  readonly #settings: FakeSettings;
  readonly #ctx: DriverContext;
  readonly #files = new Map<string, PrinterFile>();
  #status: PrinterStatus = "offline";
  #timer: ReturnType<typeof setInterval> | undefined;
  #targetC = 0;
  #actualC = 20;
  #fanPercent = 0;
  #homed: Axis[] = [];
  #position = { x: 0, y: 0, z: 0 };
  #job: string | null = null;

  constructor(init: DriverInit<FakeSettings>, ctx: DriverContext) {
    this.#settings = init.settings;
    this.#ctx = ctx;
  }

  connect(): Promise<void> {
    return run(() => {
      this.#stop();
      if (!this.#settings.reachable) {
        this.#setStatus("offline", "The printer isn't reachable. Retrying.");
        // Stands in for a reconnect loop.
        this.#timer = setInterval(() => undefined, this.#settings.tickMs);
        return;
      }
      this.#ctx.emit({
        type: "capabilities",
        capabilities: fakeCapabilities(this.#settings),
      });
      this.#setStatus("idle");
      this.#ctx.emit({
        type: "telemetry",
        telemetry: {
          temperatures: this.#temperatures(),
          fans: { part: { percent: this.#fanPercent } },
          speedPercent: 100,
          position: null,
          homedAxes: [],
        },
      });
      this.#ctx.log.info("Connected.", { tickMs: this.#settings.tickMs });
      this.#timer = setInterval(() => this.#tick(), this.#settings.tickMs);
    });
  }

  disconnect(): Promise<void> {
    return run(() => {
      this.#stop();
      this.#setStatus("offline");
    });
  }

  dispose(): Promise<void> {
    return run(() => this.#stop());
  }

  listFiles(): Promise<ListFilesResult> {
    return Promise.resolve({ files: [...this.#files.values()] });
  }

  async sendFile({ fileName, sizeBytes, path }: SendFileRequest) {
    this.#requireOnline();
    try {
      await readFile(path);
    } catch (error) {
      throw new DriverError("file_not_found", `No staged file at ${path}.`, {
        cause: error,
      });
    }
    this.#files.set(fileName, {
      name: fileName,
      sizeBytes,
      modifiedAt: new Date(0).toISOString(),
    });
    this.#ctx.emit({ type: "files_changed" });
  }

  startPrint({ fileName }: StartPrintRequest): Promise<void> {
    return run(() => {
      this.#requireStatus("idle");
      if (!this.#files.has(fileName)) {
        throw new DriverError("file_not_found", `No file ${fileName}.`);
      }
      this.#job = fileName;
      this.#ctx.emit({ type: "job_lifecycle", event: "started", fileName });
      this.#ctx.emit({
        type: "job",
        job: {
          fileName,
          progressPercent: 0,
          elapsedS: 0,
          remainingS: null,
          currentLayer: null,
          totalLayers: null,
        },
      });
      this.#setStatus("printing");
    });
  }

  pause(): Promise<void> {
    return run(() => {
      this.#requireStatus("printing");
      this.#setStatus("paused");
    });
  }

  resume(): Promise<void> {
    return run(() => {
      this.#requireStatus("paused");
      this.#setStatus("printing");
    });
  }

  cancel(): Promise<void> {
    return run(() => {
      if (this.#job === null) {
        throw new DriverError("invalid_state", "There is no job to cancel.");
      }
      const fileName = this.#job;
      this.#job = null;
      this.#ctx.emit({ type: "job_lifecycle", event: "cancelled", fileName });
      this.#ctx.emit({ type: "job", job: null });
      this.#setStatus("idle");
    });
  }

  home({ axes }: HomeRequest): Promise<void> {
    return run(() => {
      this.#requireStatus("idle");
      this.#homed = axes.length === 0 ? ["x", "y", "z"] : axes;
      this.#ctx.emit({
        type: "telemetry",
        telemetry: { homedAxes: this.#homed, position: this.#position },
      });
    });
  }

  move({ x = 0, y = 0, z = 0 }: MoveRequest): Promise<void> {
    return run(() => {
      this.#requireStatus("idle");
      if (this.#homed.length < 3) {
        throw new DriverError("invalid_state", "Home every axis first.");
      }
      const from = this.#position;
      this.#position = { x: from.x + x, y: from.y + y, z: from.z + z };
      this.#ctx.emit({
        type: "telemetry",
        telemetry: { position: this.#position },
      });
    });
  }

  setTemperature({ heaterId, targetC }: SetTemperatureRequest): Promise<void> {
    return run(() => {
      this.#requireOnline();
      if (heaterId !== "nozzle") {
        throw new DriverError("not_supported", `No heater ${heaterId}.`);
      }
      this.#targetC = targetC;
      this.#ctx.emit({
        type: "telemetry",
        telemetry: { temperatures: this.#temperatures() },
      });
    });
  }

  setFan({ fanId, percent }: SetFanRequest): Promise<void> {
    return run(() => {
      this.#requireOnline();
      if (fanId !== "part") {
        throw new DriverError("not_supported", `No fan ${fanId}.`);
      }
      this.#fanPercent = percent;
      this.#ctx.emit({
        type: "telemetry",
        telemetry: { fans: { part: { percent } } },
      });
    });
  }

  listCameras(): Promise<ListCamerasResult> {
    return Promise.resolve({
      cameras: this.#settings.cameraEnabled
        ? [{ id: "main", label: "Main" }]
        : [],
    });
  }

  getSnapshot({ cameraId }: SnapshotRequest): Promise<Snapshot> {
    if (!this.#settings.cameraEnabled || cameraId !== "main") {
      return Promise.reject(
        new DriverError("not_supported", `No camera ${cameraId}.`),
      );
    }
    return Promise.resolve({ mimeType: "image/png", data: PNG.slice() });
  }

  invokeExtension({ extension, action }: InvokeExtensionRequest) {
    return run(() => {
      if (extension !== "fake") {
        throw new DriverError("not_supported", `No extension ${extension}.`);
      }
      switch (action) {
        case "fault":
          this.#ctx.emit({
            type: "alert",
            severity: "error",
            code: "fake_fault",
            message: "A fault was injected.",
          });
          this.#setStatus("error", null, {
            code: "fake_fault",
            message: "A fault was injected.",
          });
          return;
        case "clear":
          this.#setStatus("idle");
          return;
        default:
          throw new DriverError("not_supported", `No action ${action}.`);
      }
    });
  }

  #tick(): void {
    this.#actualC += (this.#targetC - this.#actualC) / 2;
    this.#ctx.emit({
      type: "telemetry",
      telemetry: { temperatures: this.#temperatures() },
    });
  }

  #temperatures() {
    return { nozzle: { actualC: this.#actualC, targetC: this.#targetC } };
  }

  #setStatus(
    status: PrinterStatus,
    detail: string | null = null,
    error: { code: string; message: string } | null = null,
  ): void {
    this.#status = status;
    this.#ctx.emit({ type: "status", status, detail, error });
  }

  #requireOnline(): void {
    if (this.#status === "offline" || this.#status === "connecting") {
      throw new DriverError("offline", "The printer is offline.");
    }
  }

  #requireStatus(status: PrinterStatus): void {
    this.#requireOnline();
    if (this.#status !== status) {
      throw new DriverError(
        "invalid_state",
        `The printer is ${this.#status}, not ${status}.`,
      );
    }
  }

  #stop(): void {
    clearInterval(this.#timer);
    this.#timer = undefined;
  }
}

export const fakeDriver = defineDriver({
  manifest: {
    type: "fake",
    name: "Fake printer",
    description: "An in-memory printer for driver-sdk's tests.",
  },
  settingsSchema: fakeSettingsSchema,
  initialCapabilities: fakeCapabilities,
  create: (init, ctx) => new FakeDriver(init, ctx),
});

/**
 * The fake driver with some methods replaced, e.g. to emit a Date. Every real
 * fake it creates is pushed to `created`, so a test can dispose it afterwards
 * even if the patch broke `dispose`.
 */
export function patchFakeDriver(
  patch: (driver: PrinterDriver, ctx: DriverContext) => Partial<PrinterDriver>,
  created: PrinterDriver[] = [],
): DriverModule<typeof fakeSettingsSchema> {
  return defineDriver({
    ...fakeDriver,
    create(init, ctx) {
      const driver = fakeDriver.create(init, ctx);
      created.push(driver);
      const methods = driver as unknown as Record<string, unknown>;
      const bound = Object.fromEntries(
        DRIVER_OPS.flatMap((op) => {
          const method = methods[op];
          return typeof method === "function"
            ? [[op, method.bind(driver) as unknown]]
            : [];
        }),
      ) as unknown as PrinterDriver;
      return { ...bound, ...patch(driver, ctx) };
    },
  });
}
