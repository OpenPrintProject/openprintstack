// SPDX-FileCopyrightText: 2026 Open Print Stack contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { z } from "zod";

import { Capabilities } from "./capabilities.ts";
import { PrinterCommand } from "./commands.ts";
import { ErrorInfo, Id, IsoDateTime } from "./common.ts";
import { Filament } from "./filament.ts";
import { PrinterStatus } from "./status.ts";
import { Telemetry } from "./telemetry.ts";

export const EventCategory = z
  .enum(["telemetry", "state", "command", "config", "auth", "system"])
  .meta({ id: "EventCategory" });

export type EventCategory = z.infer<typeof EventCategory>;

export const EventType = z
  .enum([
    "printer.telemetry",
    "printer.status_changed",
    "printer.capabilities_changed",
    "printer.alert",
    "printer.job_started",
    "printer.job_ended",
    "printer.files_changed",
    "printer.filament_changed",
    "command.requested",
    "command.result",
    "printer.added",
    "printer.updated",
    "printer.removed",
    "auth.setup_completed",
    "auth.login_succeeded",
    "auth.login_failed",
    "auth.logout",
    "system.started",
    "system.stopping",
  ])
  .meta({ id: "EventType" });

export type EventType = z.infer<typeof EventType>;

/** The category of each event type. The server stamps it onto the envelope. */
export const EVENT_CATEGORY = {
  "printer.telemetry": "telemetry",
  "printer.status_changed": "state",
  "printer.capabilities_changed": "state",
  "printer.alert": "state",
  "printer.job_started": "state",
  "printer.job_ended": "state",
  "printer.files_changed": "state",
  "printer.filament_changed": "state",
  "command.requested": "command",
  "command.result": "command",
  "printer.added": "config",
  "printer.updated": "config",
  "printer.removed": "config",
  "auth.setup_completed": "auth",
  "auth.login_succeeded": "auth",
  "auth.login_failed": "auth",
  "auth.logout": "auth",
  "system.started": "system",
  "system.stopping": "system",
} as const satisfies Record<EventType, EventCategory>;

/** Who caused an event. */
export const EventSource = z
  .discriminatedUnion("kind", [
    z.object({ kind: z.literal("driver") }),
    z.object({ kind: z.literal("user"), userId: Id }),
    z.object({ kind: z.literal("system") }),
  ])
  .meta({ id: "EventSource" });

export type EventSource = z.infer<typeof EventSource>;

const envelope = {
  /** A UUIDv7, so ids sort by creation time. */
  id: z.uuidv7(),
  ts: IsoDateTime,
  /** Increases by one per event within a boot. Ordering is total. */
  seq: z.int().nonnegative(),
  bootId: Id,
  /** On command events, the `commandId`. */
  correlationId: Id.nullable(),
  source: EventSource,
};

/** An event about one printer. Command events are always for a printer. */
function printerEvent<const T extends EventType, P extends z.ZodType>(
  type: T,
  payload: P,
) {
  return z.object({
    ...envelope,
    printerId: Id,
    type: z.literal(type),
    category: z.literal(EVENT_CATEGORY[type]),
    payload,
  });
}

/** An event that isn't about any printer (auth and system). */
function globalEvent<const T extends EventType, P extends z.ZodType>(
  type: T,
  payload: P,
) {
  return z.object({
    ...envelope,
    printerId: z.null(),
    type: z.literal(type),
    category: z.literal(EVENT_CATEGORY[type]),
    payload,
  });
}

const FileName = z.string().min(1);

export const AlertSeverity = z
  .enum(["info", "warning", "error"])
  .meta({ id: "AlertSeverity" });

export type AlertSeverity = z.infer<typeof AlertSeverity>;

export const JobOutcome = z
  .enum(["completed", "cancelled", "failed"])
  .meta({ id: "JobOutcome" });

export type JobOutcome = z.infer<typeof JobOutcome>;

// Telemetry

export const PrinterTelemetryEvent = printerEvent(
  "printer.telemetry",
  z.object({ telemetry: Telemetry }),
).meta({ id: "PrinterTelemetryEvent" });

// State

export const PrinterStatusChangedEvent = printerEvent(
  "printer.status_changed",
  z.object({
    /** Null for the first status after the server starts. */
    previous: PrinterStatus.nullable(),
    status: PrinterStatus,
    detail: z.string().nullable(),
    error: ErrorInfo.nullable(),
  }),
).meta({ id: "PrinterStatusChangedEvent" });

export const PrinterCapabilitiesChangedEvent = printerEvent(
  "printer.capabilities_changed",
  z.object({ capabilities: Capabilities }),
).meta({ id: "PrinterCapabilitiesChangedEvent" });

export const PrinterAlertEvent = printerEvent(
  "printer.alert",
  z.object({
    severity: AlertSeverity,
    /** A machine-readable id, such as `filament_runout`. */
    code: z.string().min(1),
    message: z.string(),
  }),
).meta({ id: "PrinterAlertEvent" });

export const PrinterJobStartedEvent = printerEvent(
  "printer.job_started",
  z.object({ fileName: FileName }),
).meta({ id: "PrinterJobStartedEvent" });

export const PrinterJobEndedEvent = printerEvent(
  "printer.job_ended",
  z.object({ outcome: JobOutcome, fileName: FileName }),
).meta({ id: "PrinterJobEndedEvent" });

/** The printer's file list changed. Clients fetch the new list. */
export const PrinterFilesChangedEvent = printerEvent(
  "printer.files_changed",
  z.object({}),
).meta({ id: "PrinterFilesChangedEvent" });

/**
 * The printer's filament readout changed. Carries the whole readout, never a
 * patch: null when the printer stopped reporting filament.
 */
export const PrinterFilamentChangedEvent = printerEvent(
  "printer.filament_changed",
  z.object({ filament: Filament.nullable() }),
).meta({ id: "PrinterFilamentChangedEvent" });

// Command

export const CommandRequestedEvent = printerEvent(
  "command.requested",
  z.object({ commandId: Id, command: PrinterCommand }),
).meta({ id: "CommandRequestedEvent" });

export const CommandResultEvent = printerEvent(
  "command.result",
  z.object({
    commandId: Id,
    ok: z.boolean(),
    error: ErrorInfo.optional(),
    durationMs: z.number().nonnegative(),
  }),
).meta({ id: "CommandResultEvent" });

// Config. Payloads never carry settings values, which can hold secrets.

export const PrinterAddedEvent = printerEvent(
  "printer.added",
  z.object({ name: z.string().min(1), driverType: z.string().min(1) }),
).meta({ id: "PrinterAddedEvent" });

export const PrinterUpdatedEvent = printerEvent(
  "printer.updated",
  z.object({ changedFields: z.array(z.enum(["name", "settings"])) }),
).meta({ id: "PrinterUpdatedEvent" });

export const PrinterRemovedEvent = printerEvent(
  "printer.removed",
  z.object({ name: z.string().min(1) }),
).meta({ id: "PrinterRemovedEvent" });

// Auth

export const AuthSetupCompletedEvent = globalEvent(
  "auth.setup_completed",
  z.object({}),
).meta({ id: "AuthSetupCompletedEvent" });

export const AuthLoginSucceededEvent = globalEvent(
  "auth.login_succeeded",
  z.object({}),
).meta({ id: "AuthLoginSucceededEvent" });

export const AuthLoginFailedEvent = globalEvent(
  "auth.login_failed",
  z.object({ username: z.string() }),
).meta({ id: "AuthLoginFailedEvent" });

export const AuthLogoutEvent = globalEvent("auth.logout", z.object({})).meta({
  id: "AuthLogoutEvent",
});

// System

export const SystemStartedEvent = globalEvent(
  "system.started",
  z.object({ version: z.string().min(1) }),
).meta({ id: "SystemStartedEvent" });

export const SystemStoppingEvent = globalEvent(
  "system.stopping",
  z.object({}),
).meta({ id: "SystemStoppingEvent" });

/** Every event the bus carries, persists and sends to clients. */
export const OpsEvent = z
  .discriminatedUnion("type", [
    PrinterTelemetryEvent,
    PrinterStatusChangedEvent,
    PrinterCapabilitiesChangedEvent,
    PrinterAlertEvent,
    PrinterJobStartedEvent,
    PrinterJobEndedEvent,
    PrinterFilesChangedEvent,
    PrinterFilamentChangedEvent,
    CommandRequestedEvent,
    CommandResultEvent,
    PrinterAddedEvent,
    PrinterUpdatedEvent,
    PrinterRemovedEvent,
    AuthSetupCompletedEvent,
    AuthLoginSucceededEvent,
    AuthLoginFailedEvent,
    AuthLogoutEvent,
    SystemStartedEvent,
    SystemStoppingEvent,
  ])
  .meta({ id: "OpsEvent" });

export type OpsEvent = z.infer<typeof OpsEvent>;

export type OpsEventOf<T extends EventType> = Extract<OpsEvent, { type: T }>;

export type EventPayload<T extends EventType> = OpsEventOf<T>["payload"];
