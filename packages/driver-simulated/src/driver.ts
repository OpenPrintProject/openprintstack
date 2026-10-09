// SPDX-FileCopyrightText: 2026 Open Print Stack contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  type DriverContext,
  DriverError,
  type DriverInit,
  type DriverMessage,
  type HomeRequest,
  type LogData,
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
  type TelemetryPatch,
} from "@openprintstack/driver-sdk";

import {
  CAMERA,
  MAX_UPLOAD_BYTES,
  SIMULATOR_EXTENSION,
  simulatedCapabilities,
} from "./capabilities.ts";
import { isSimulatorAction, parseParams } from "./extension.ts";
import { checkFileName, FileStore } from "./files.ts";
import { SimulatedPrinter } from "./printer.ts";
import type { SimulatedSettings } from "./settings.ts";
import { renderSnapshot } from "./snapshot.ts";

// The connection to a simulated printer. The printer itself (`printer.ts`)
// keeps running from the first connect until dispose, even while the link is
// down; this class ticks it, reports what changed, and simulates the link.

/** Real milliseconds between ticks, whatever the speed. */
export const TICK_MS = 500;

export const DISCONNECT_DETAIL =
  "Simulated disconnect. It reconnects by itself.";

export const DEFAULT_ERROR_MESSAGE = "A simulated error was injected.";

/** What the host last received, as JSON, so that ticks only send changes. */
type Sent = {
  status?: string;
  job?: string;
  filament?: string;
  telemetry: Record<string, string>;
};

/** Runs a synchronous step as an async method would: a throw rejects. */
function run<T>(step: () => T): Promise<T> {
  return new Promise((resolve) => resolve(step()));
}

export class SimulatedDriver implements PrinterDriver {
  readonly #settings: SimulatedSettings;
  readonly #ctx: DriverContext;
  readonly #printer: SimulatedPrinter;
  readonly #files: FileStore;
  /** The simulation speed: the setting, until `set_speed` changes it. */
  #speed: number;
  /** Whether the host wants a connection: from connect until disconnect. */
  #wanted = false;
  /** Whether the printer is reachable and reported online. */
  #online = false;
  #sent: Sent = { telemetry: {} };
  /** Events that happened while offline, sent when it reconnects. */
  #backlog: DriverMessage[] = [];
  #ticker: ReturnType<typeof setInterval> | undefined;
  /** Ends a simulated disconnect. */
  #outage: ReturnType<typeof setTimeout> | undefined;
  #disposed = false;

  constructor(init: DriverInit<SimulatedSettings>, ctx: DriverContext) {
    this.#settings = init.settings;
    this.#ctx = ctx;
    this.#printer = new SimulatedPrinter(init.settings);
    this.#files = new FileStore(init.storageDir);
    this.#speed = init.settings.speedMultiplier;
  }

  // Connection

  connect(): Promise<void> {
    return run(() => {
      this.#wanted = true;
      this.#ticker ??= setInterval(() => this.#tick(), TICK_MS);
      if (this.#outage === undefined) {
        this.#goOnline();
      } else {
        this.#goOffline(DISCONNECT_DETAIL);
      }
    });
  }

  disconnect(): Promise<void> {
    return run(() => {
      this.#wanted = false;
      this.#goOffline(null);
    });
  }

  dispose(): Promise<void> {
    return run(() => {
      // #emit checks this, so work still in flight (an upload being copied)
      // reports nothing.
      this.#disposed = true;
      clearInterval(this.#ticker);
      this.#ticker = undefined;
      clearTimeout(this.#outage);
      this.#outage = undefined;
    });
  }

  // Files

  async listFiles(): Promise<ListFilesResult> {
    this.#requireOnline();
    return { files: await this.#files.list() };
  }

  async sendFile({ fileName, sizeBytes, path }: SendFileRequest) {
    this.#requireOnline();
    checkFileName(fileName);
    if (sizeBytes > MAX_UPLOAD_BYTES) {
      throw new DriverError(
        "printer_rejected",
        `The file is ${sizeBytes} bytes; the printer takes at most ${MAX_UPLOAD_BYTES}.`,
      );
    }
    if (fileName === this.#printer.jobFileName) {
      throw new DriverError(
        "invalid_state",
        `${JSON.stringify(fileName)} is being printed, so it can't be replaced.`,
      );
    }
    await this.#files.add(fileName, path);
    this.#publish({ type: "files_changed" });
  }

  // Printing, motion, heat and fans

  async startPrint({ fileName }: StartPrintRequest) {
    this.#requireOnline();
    checkFileName(fileName);
    if (!(await this.#files.has(fileName))) {
      throw new DriverError(
        "file_not_found",
        `There is no file ${JSON.stringify(fileName)} on the printer.`,
      );
    }
    this.#command(() => this.#printer.startPrint(fileName));
  }

  pause(): Promise<void> {
    return run(() => this.#command(() => this.#printer.pause()));
  }

  resume(): Promise<void> {
    return run(() => this.#command(() => this.#printer.resume()));
  }

  cancel(): Promise<void> {
    return run(() => this.#command(() => this.#printer.cancel()));
  }

  home({ axes }: HomeRequest): Promise<void> {
    return run(() => this.#command(() => this.#printer.home(axes)));
  }

  move(request: MoveRequest): Promise<void> {
    return run(() => this.#command(() => this.#printer.move(request)));
  }

  setTemperature(request: SetTemperatureRequest): Promise<void> {
    return run(() =>
      this.#command(() => this.#printer.setTemperature(request)),
    );
  }

  setFan(request: SetFanRequest): Promise<void> {
    return run(() => this.#command(() => this.#printer.setFan(request)));
  }

  // Cameras

  listCameras(): Promise<ListCamerasResult> {
    return run(() => {
      this.#requireOnline();
      return { cameras: this.#settings.cameraEnabled ? [{ ...CAMERA }] : [] };
    });
  }

  getSnapshot({ cameraId }: SnapshotRequest): Promise<Snapshot> {
    return run(() => {
      this.#requireOnline();
      if (!this.#settings.cameraEnabled || cameraId !== CAMERA.id) {
        throw new DriverError(
          "not_supported",
          `The printer has no camera "${cameraId}".`,
        );
      }
      return {
        mimeType: "image/png",
        data: renderSnapshot(
          this.#printer.status,
          this.#printer.job()?.progressPercent ?? null,
        ),
      };
    });
  }

  // The `simulator` extension. Faults need the printer online; `clear` and
  // `set_speed` work in any state.

  invokeExtension({
    extension,
    action,
    params,
  }: InvokeExtensionRequest): Promise<void> {
    return run(() => {
      if (extension !== SIMULATOR_EXTENSION) {
        throw new DriverError(
          "not_supported",
          `The simulated printer has no extension "${extension}".`,
        );
      }
      if (!isSimulatorAction(action)) {
        throw new DriverError(
          "not_supported",
          `The simulator has no action "${action}".`,
        );
      }
      switch (action) {
        case "fault.error": {
          const message =
            parseParams(action, params)?.message ?? DEFAULT_ERROR_MESSAGE;
          this.#command(() => this.#printer.fail(message));
          return;
        }
        case "fault.filament_runout":
          parseParams(action, params);
          this.#command(() => this.#printer.filamentRunout());
          return;
        case "fault.disconnect": {
          const { durationS } = parseParams(action, params);
          this.#requireOnline();
          this.#outage = setTimeout(() => this.#endOutage(), durationS * 1000);
          this.#goOffline(DISCONNECT_DETAIL);
          this.#log("warn", "Simulated disconnect.", { durationS });
          return;
        }
        case "clear":
          parseParams(action, params);
          this.#printer.clearError();
          this.#sync();
          if (this.#outage !== undefined) {
            this.#endOutage();
          }
          return;
        case "set_speed": {
          const { multiplier } = parseParams(action, params);
          this.#speed = multiplier;
          this.#log("info", "Simulation speed changed.", { multiplier });
          return;
        }
      }
    });
  }

  // Internals

  #tick(): void {
    this.#printer.advance((TICK_MS / 1000) * this.#speed);
    this.#sync();
  }

  /** Runs a command on the printer and reports what it changed. */
  #command(step: () => void): void {
    this.#requireOnline();
    step();
    this.#sync();
  }

  #requireOnline(): void {
    if (!this.#online) {
      throw new DriverError("offline", "The printer is offline.");
    }
  }

  /**
   * Reports the printer's new events, then whatever changed in its job,
   * telemetry, filament and status, in that order: e.g. `completed`, then
   * `job: null`, then the cooled heaters, then slot 1 back to loaded, then
   * `idle`. While offline, events wait in the backlog and state is sent in
   * full on reconnect.
   */
  #sync(): void {
    for (const event of this.#printer.takeEvents()) {
      this.#publish(event);
    }
    if (!this.#online) {
      return;
    }

    const job = this.#printer.job();
    const jobJson = JSON.stringify(job);
    if (jobJson !== this.#sent.job) {
      this.#sent.job = jobJson;
      this.#emit({ type: "job", job });
    }

    const patch: TelemetryPatch = {};
    for (const [key, value] of Object.entries(this.#printer.telemetry())) {
      const json = JSON.stringify(value);
      if (this.#sent.telemetry[key] !== json) {
        this.#sent.telemetry[key] = json;
        Object.assign(patch, { [key]: value });
      }
    }
    if (Object.keys(patch).length > 0) {
      this.#emit({ type: "telemetry", telemetry: patch });
    }

    const filament = this.#printer.filament();
    const filamentJson = JSON.stringify(filament);
    if (filamentJson !== this.#sent.filament) {
      this.#sent.filament = filamentJson;
      this.#emit({ type: "filament", filament });
    }

    const status = this.#printer.statusInfo();
    const statusJson = JSON.stringify(status);
    if (statusJson !== this.#sent.status) {
      this.#sent.status = statusJson;
      this.#emit({ type: "status", ...status });
    }
  }

  /**
   * Reports everything, as the host has nothing: it resets its telemetry
   * whenever a printer goes offline. (It keeps the filament readout, though,
   * and publishes nothing when the same one comes again.) The status comes
   * first, so the printer is back before anything that happened while it was
   * away.
   */
  #goOnline(): void {
    this.#online = true;
    this.#sent = { telemetry: {} };
    this.#emit({
      type: "capabilities",
      capabilities: simulatedCapabilities(this.#settings),
    });
    const status = this.#printer.statusInfo();
    this.#sent.status = JSON.stringify(status);
    this.#emit({ type: "status", ...status });
    const backlog = this.#backlog;
    this.#backlog = [];
    for (const message of backlog) {
      this.#emit(message);
    }
    this.#sync();
    this.#log("info", "Connected to the simulated printer.", {
      speedMultiplier: this.#speed,
    });
  }

  #goOffline(detail: string | null): void {
    this.#online = false;
    this.#emit({ type: "status", status: "offline", detail, error: null });
  }

  #endOutage(): void {
    clearTimeout(this.#outage);
    this.#outage = undefined;
    if (this.#wanted && !this.#online) {
      this.#goOnline();
    }
  }

  /** Sends an event now, or when the printer reconnects. */
  #publish(message: DriverMessage): void {
    if (this.#online) {
      this.#emit(message);
    } else {
      this.#backlog.push(message);
    }
  }

  #emit(message: DriverMessage): void {
    if (!this.#disposed) {
      this.#ctx.emit(message);
    }
  }

  /** As `ctx.log`, but through `#emit`, so nothing is logged after dispose. */
  #log(level: "info" | "warn", message: string, data: LogData): void {
    this.#emit({ type: "log", level, message, data });
  }
}
