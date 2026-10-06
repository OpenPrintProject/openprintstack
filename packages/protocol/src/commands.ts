// SPDX-FileCopyrightText: 2026 Open Print Stack contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { z } from "zod";

import { Axis, Id, JsonValue } from "./common.ts";

// Commands only check the bounds that follow from their units. Printer-specific
// limits (maxC, build volume, maximum speed) belong to the server's safety check.

export const CommandKind = z
  .enum([
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
  ])
  .meta({ id: "CommandKind" });

export type CommandKind = z.infer<typeof CommandKind>;

const FileName = z.string().min(1);

export const PrintStartCommand = z
  .object({
    kind: z.literal("print.start"),
    fileName: FileName,
  })
  .meta({ id: "PrintStartCommand" });

export const PrintPauseCommand = z
  .object({ kind: z.literal("print.pause") })
  .meta({ id: "PrintPauseCommand" });

export const PrintResumeCommand = z
  .object({ kind: z.literal("print.resume") })
  .meta({ id: "PrintResumeCommand" });

export const PrintCancelCommand = z
  .object({ kind: z.literal("print.cancel") })
  .meta({ id: "PrintCancelCommand" });

export const MotionHomeCommand = z
  .object({
    kind: z.literal("motion.home"),
    /** The axes to home. An empty array homes all of them. */
    axes: z.array(Axis),
  })
  .meta({ id: "MotionHomeCommand" });

/** A relative move ("jog") in mm. Absolute moves are not supported. */
export const MotionMoveCommand = z
  .object({
    kind: z.literal("motion.move"),
    x: z.number().optional(),
    y: z.number().optional(),
    z: z.number().optional(),
    speedMmS: z.number().positive().optional(),
  })
  .refine(
    (move) =>
      move.x !== undefined || move.y !== undefined || move.z !== undefined,
    { message: "A move needs at least one of x, y or z." },
  )
  .meta({ id: "MotionMoveCommand" });

export const TemperatureSetCommand = z
  .object({
    kind: z.literal("temperature.set"),
    heaterId: Id,
    /** The target in °C. 0 turns the heater off. */
    targetC: z.number().nonnegative(),
  })
  .meta({ id: "TemperatureSetCommand" });

export const FanSetCommand = z
  .object({
    kind: z.literal("fan.set"),
    fanId: Id,
    percent: z.number().min(0).max(100),
  })
  .meta({ id: "FanSetCommand" });

/**
 * Sends a file the server has already staged. Only the server creates this
 * command, after it has received the upload.
 */
export const FileUploadCommand = z
  .object({
    kind: z.literal("file.upload"),
    stagedFileId: Id,
    fileName: FileName,
    sizeBytes: z.int().nonnegative(),
  })
  .meta({ id: "FileUploadCommand" });

/** Runs a driver-specific action, such as a simulator fault. */
export const ExtensionInvokeCommand = z
  .object({
    kind: z.literal("extension.invoke"),
    extension: z.string().min(1),
    action: z.string().min(1),
    params: JsonValue,
  })
  .meta({ id: "ExtensionInvokeCommand" });

export const PrinterCommand = z
  .discriminatedUnion("kind", [
    PrintStartCommand,
    PrintPauseCommand,
    PrintResumeCommand,
    PrintCancelCommand,
    MotionHomeCommand,
    MotionMoveCommand,
    TemperatureSetCommand,
    FanSetCommand,
    FileUploadCommand,
    ExtensionInvokeCommand,
  ])
  .meta({ id: "PrinterCommand" });

export type PrinterCommand = z.infer<typeof PrinterCommand>;

export type PrinterCommandOf<K extends CommandKind> = Extract<
  PrinterCommand,
  { kind: K }
>;
