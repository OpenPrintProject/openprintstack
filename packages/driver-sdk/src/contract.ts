// SPDX-FileCopyrightText: 2026 Open Print Stack contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  Camera,
  type Capabilities,
  type CommandKind,
  type PrinterCommandOf,
  PrinterFile,
} from "@openprintstack/protocol";
import { z } from "zod";

import type { DriverMessage, LogData } from "./messages.ts";

// What every printer driver implements. Requests and results are plain,
// serialisable objects, so that a driver can later run in a worker or a child
// process without changing this contract.

export const DriverManifest = z.object({
  /** The driver type key, such as `simulated`. The server's registry checks it. */
  type: z.string().min(1),
  /** A display name, such as "Simulated printer". */
  name: z.string().min(1),
  /** One sentence for the add-printer form. */
  description: z.string().min(1),
});

export type DriverManifest = z.infer<typeof DriverManifest>;

// Data shapes are type aliases, not interfaces: an interface has no implicit
// index signature, so it never matches protocol's Serializable.

/** The data a driver is created with. It crosses a worker boundary as-is. */
export type DriverInit<Settings> = {
  readonly printerId: string;
  /** Already parsed by the module's `settingsSchema`, so defaults are applied. */
  readonly settings: Settings;
  /**
   * An absolute path to a folder only this printer's driver uses. It exists
   * before `create` runs, survives restarts, and is deleted with the printer.
   */
  readonly storageDir: string;
};

/** Writes `log` messages, which go to the server's log, not the event bus. */
export interface DriverLogger {
  debug(message: string, data?: LogData): void;
  info(message: string, data?: LogData): void;
  warn(message: string, data?: LogData): void;
  error(message: string, data?: LogData): void;
}

/** The services the host gives a driver. */
export interface DriverContext {
  /**
   * Reports state to the host. While cloning (in dev and test), it throws a
   * `TypeError` straight away if the message isn't serialisable, e.g. if it
   * holds a Date or a function.
   */
  emit(message: DriverMessage): void;
  readonly log: DriverLogger;
}

/** A flat Zod object: every field a string, number, boolean or enum. */
export type SettingsSchema = z.ZodObject;

/** What a driver package exports (as its default export). */
export interface DriverModule<S extends SettingsSchema = SettingsSchema> {
  readonly manifest: DriverManifest;
  /**
   * The printer's settings. The UI renders it as a form through
   * `settingsJsonSchema`. Defaults come from `.default()` on each field.
   */
  readonly settingsSchema: S;
  /** The capabilities to show before the driver has connected. */
  initialCapabilities(settings: z.output<S>): Capabilities;
  /** Creates the driver without connecting it. */
  create(init: DriverInit<z.output<S>>, ctx: DriverContext): PrinterDriver;
}

/** Infers the settings type for `create` and `initialCapabilities`. */
export function defineDriver<S extends SettingsSchema>(
  module: DriverModule<S>,
): DriverModule<S> {
  return module;
}

/** A command's fields without its `kind`. */
type CommandRequest<K extends CommandKind> = Omit<PrinterCommandOf<K>, "kind">;

export type StartPrintRequest = CommandRequest<"print.start">;
export type HomeRequest = CommandRequest<"motion.home">;
export type MoveRequest = CommandRequest<"motion.move">;
export type SetTemperatureRequest = CommandRequest<"temperature.set">;
export type SetFanRequest = CommandRequest<"fan.set">;
export type InvokeExtensionRequest = CommandRequest<"extension.invoke">;

/** Sends a file the server has staged. Copy it; never move or delete it. */
export type SendFileRequest = {
  readonly fileName: string;
  readonly sizeBytes: number;
  /** The absolute path of the staged file. */
  readonly path: string;
};

export type SnapshotRequest = {
  readonly cameraId: string;
};

export const ListFilesResult = z.object({ files: z.array(PrinterFile) });

export type ListFilesResult = z.infer<typeof ListFilesResult>;

export const ListCamerasResult = z.object({ cameras: z.array(Camera) });

export type ListCamerasResult = z.infer<typeof ListCamerasResult>;

/**
 * One camera image. The REST API serves `data` from the app's own origin with
 * `mimeType` as its content type, so only image types are accepted, and not
 * SVG, which can carry scripts.
 */
export const Snapshot = z.object({
  mimeType: z.string().regex(/^image\/(?!svg)[\w.+-]+$/),
  data: z.custom<Uint8Array>((value) => value instanceof Uint8Array, {
    message: "Expected a Uint8Array",
  }),
});

export type Snapshot = z.infer<typeof Snapshot>;

/**
 * A connection to one printer. Every method is async and fails with a
 * `DriverError`. The host checks capabilities, the command policy and safety
 * limits before it calls a command method; the driver still reports
 * `invalid_state` or `printer_rejected` when the printer disagrees.
 */
export interface PrinterDriver {
  /**
   * Starts connecting and resolves once the first attempt is over, having
   * emitted a `status`: an online one, or `offline` if the printer can't be
   * reached. While offline it keeps reconnecting by itself until
   * `disconnect`. Network failures are reported as `offline`, never thrown.
   */
  connect(): Promise<void>;
  /** Stops connecting or reconnecting, then emits `offline`. */
  disconnect(): Promise<void>;
  /** Releases everything (timers, sockets). Nothing is emitted afterwards. */
  dispose(): Promise<void>;

  listFiles(): Promise<ListFilesResult>;
  sendFile(request: SendFileRequest): Promise<void>;

  startPrint(request: StartPrintRequest): Promise<void>;
  pause(): Promise<void>;
  resume(): Promise<void>;
  cancel(): Promise<void>;

  /** An empty `axes` homes every axis. */
  home(request: HomeRequest): Promise<void>;
  /** A relative move in mm. */
  move(request: MoveRequest): Promise<void>;

  setTemperature(request: SetTemperatureRequest): Promise<void>;
  setFan(request: SetFanRequest): Promise<void>;

  listCameras(): Promise<ListCamerasResult>;
  getSnapshot(request: SnapshotRequest): Promise<Snapshot>;

  /**
   * Runs a driver-specific action. Allowed in every status, including offline,
   * so the driver decides. Unknown extensions or actions fail with
   * `not_supported`.
   */
  invokeExtension?(request: InvokeExtensionRequest): Promise<void>;
}
