// SPDX-FileCopyrightText: 2026 Open Print Stack contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { PrinterCommand } from "@openprintstack/protocol";
import type { z } from "zod";

import {
  ListCamerasResult,
  ListFilesResult,
  type PrinterDriver,
  Snapshot,
} from "./contract.ts";

// An "op" is the name of a PrinterDriver method. Requests name the op to run.

/**
 * Every op, with the schema of what it resolves with, or null for ops that
 * resolve with nothing (they answer `null` on the wire).
 */
export const DRIVER_OP_RESULTS = {
  connect: null,
  disconnect: null,
  dispose: null,
  listFiles: ListFilesResult,
  sendFile: null,
  startPrint: null,
  pause: null,
  resume: null,
  cancel: null,
  home: null,
  move: null,
  setTemperature: null,
  setFan: null,
  listCameras: ListCamerasResult,
  getSnapshot: Snapshot,
  invokeExtension: null,
} as const satisfies {
  readonly [Op in keyof PrinterDriver]-?: z.ZodType | null;
};

export type DriverOp = keyof PrinterDriver;

export const DRIVER_OPS = Object.keys(DRIVER_OP_RESULTS) as DriverOp[];

/** Own keys only, so `toString` or `__proto__` never reach a driver. */
export function isDriverOp(op: string): op is DriverOp {
  return Object.hasOwn(DRIVER_OP_RESULTS, op);
}

type Method<Op extends DriverOp> = NonNullable<PrinterDriver[Op]>;

/** The args of an op that takes no request. */
export type EmptyArgs = Record<string, never>;

/** What an op takes on the wire: its request, or `{}`. */
export type DriverArgs<Op extends DriverOp> =
  Parameters<Method<Op>> extends [infer Request] ? Request : EmptyArgs;

/** What an op resolves with. */
export type DriverResult<Op extends DriverOp> = Awaited<ReturnType<Method<Op>>>;

/** What an op answers with on the wire: its result, or `null`. */
export type WireResult<Op extends DriverOp> = [DriverResult<Op>] extends [void]
  ? null
  : DriverResult<Op>;

/** One call the host makes, e.g. `{ op: "setFan", args: { fanId, percent } }`. */
export type DriverCall = {
  [Op in DriverOp]: { op: Op; args: DriverArgs<Op> };
}[DriverOp];

/**
 * The call that carries out a command. Only the host knows where staged files
 * are, so `file.upload` asks `stagedFilePath` for the staged file's path.
 */
export function callForCommand(
  command: PrinterCommand,
  stagedFilePath: (stagedFileId: string) => string,
): DriverCall {
  switch (command.kind) {
    case "print.start":
      return { op: "startPrint", args: { fileName: command.fileName } };
    case "print.pause":
      return { op: "pause", args: {} };
    case "print.resume":
      return { op: "resume", args: {} };
    case "print.cancel":
      return { op: "cancel", args: {} };
    case "motion.home":
      return { op: "home", args: { axes: command.axes } };
    case "motion.move": {
      const { x, y, z, speedMmS } = command;
      return { op: "move", args: withoutUndefined({ x, y, z, speedMmS }) };
    }
    case "temperature.set":
      return {
        op: "setTemperature",
        args: { heaterId: command.heaterId, targetC: command.targetC },
      };
    case "fan.set":
      return {
        op: "setFan",
        args: { fanId: command.fanId, percent: command.percent },
      };
    case "file.upload":
      return {
        op: "sendFile",
        args: {
          fileName: command.fileName,
          sizeBytes: command.sizeBytes,
          path: stagedFilePath(command.stagedFileId),
        },
      };
    case "extension.invoke":
      return {
        op: "invokeExtension",
        args: {
          extension: command.extension,
          action: command.action,
          params: command.params,
        },
      };
  }
}

function withoutUndefined<T extends object>(object: T): T {
  return Object.fromEntries(
    Object.entries(object).filter(([, value]) => value !== undefined),
  ) as T;
}
