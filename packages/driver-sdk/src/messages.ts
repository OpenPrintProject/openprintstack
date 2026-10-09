// SPDX-FileCopyrightText: 2026 Open Print Stack contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  AlertSeverity,
  Capabilities,
  ErrorInfo,
  Filament,
  JobOutcome,
  JobProgress,
  PrinterStatus,
  Telemetry,
} from "@openprintstack/protocol";
import { z } from "zod";

// What drivers report through `ctx.emit`. The host parses each message with
// `DriverMessage`, then stamps it into an event (drivers never create ids or
// timestamps). Driver readings are not range-checked.

/** Becomes `printer.status_changed`; the host fills in `previous`. */
export const DriverStatusMessage = z.object({
  type: z.literal("status"),
  status: PrinterStatus,
  detail: z.string().nullable(),
  error: ErrorInfo.nullable(),
});

/**
 * Only the telemetry fields that changed. A field that is present replaces the
 * whole field (so `temperatures` carries every heater); one that is left out,
 * or `undefined`, is unchanged; `null` means the printer no longer reports it.
 * `job` is left out: the `job` message sets it.
 */
export const TelemetryPatch = Telemetry.omit({ job: true }).partial();

export type TelemetryPatch = z.infer<typeof TelemetryPatch>;

/**
 * Merged into the host's telemetry by `reduceTelemetry`, which the host then
 * publishes in full as `printer.telemetry`. The host's merged telemetry resets
 * when the printer goes offline or connecting, as the shared reducer's does.
 */
export const DriverTelemetryMessage = z.object({
  type: z.literal("telemetry"),
  telemetry: TelemetryPatch,
});

/**
 * The current job's progress, or null when there is no job. The only way to
 * set `telemetry.job`.
 */
export const DriverJobMessage = z.object({
  type: z.literal("job"),
  job: JobProgress.nullable(),
});

export const JobLifecycleEvent = z.enum(["started", ...JobOutcome.options]);

export type JobLifecycleEvent = z.infer<typeof JobLifecycleEvent>;

/** Becomes `printer.job_started`, or `printer.job_ended` with the outcome. */
export const DriverJobLifecycleMessage = z.object({
  type: z.literal("job_lifecycle"),
  event: JobLifecycleEvent,
  fileName: z.string().min(1),
});

/** Becomes `printer.capabilities_changed`. */
export const DriverCapabilitiesMessage = z.object({
  type: z.literal("capabilities"),
  capabilities: Capabilities,
});

/**
 * The whole filament readout, never a patch, or null when the printer doesn't
 * report filament. Becomes `printer.filament_changed`, only when it changes.
 * The host keeps the last one while the printer is offline and across
 * restarts, so a driver that has stopped reporting filament sends null.
 */
export const DriverFilamentMessage = z.object({
  type: z.literal("filament"),
  filament: Filament.nullable(),
});

/** Becomes `printer.files_changed`. */
export const DriverFilesChangedMessage = z.object({
  type: z.literal("files_changed"),
});

/** Becomes `printer.alert`. */
export const DriverAlertMessage = z.object({
  type: z.literal("alert"),
  severity: AlertSeverity,
  /** A machine-readable id, such as `filament_runout`. */
  code: z.string().min(1),
  message: z.string(),
});

export const LogLevel = z.enum(["debug", "info", "warn", "error"]);

export type LogLevel = z.infer<typeof LogLevel>;

/** Extra fields for a log line, merged into it by pino. */
export const LogData = z.record(z.string(), z.json());

export type LogData = z.infer<typeof LogData>;

/** Goes to the server's log (pino), not the event bus. */
export const DriverLogMessage = z.object({
  type: z.literal("log"),
  level: LogLevel,
  message: z.string(),
  data: LogData.optional(),
});

export const DriverMessage = z.discriminatedUnion("type", [
  DriverStatusMessage,
  DriverTelemetryMessage,
  DriverJobMessage,
  DriverJobLifecycleMessage,
  DriverCapabilitiesMessage,
  DriverFilamentMessage,
  DriverFilesChangedMessage,
  DriverAlertMessage,
  DriverLogMessage,
]);

export type DriverMessage = z.infer<typeof DriverMessage>;

export type DriverMessageOf<T extends DriverMessage["type"]> = Extract<
  DriverMessage,
  { type: T }
>;
