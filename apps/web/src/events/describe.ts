// SPDX-FileCopyrightText: 2026 Open Print Stack contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import type {
  AlertSeverity,
  EventCategory,
  EventSource,
  EventType,
  OpsEvent,
  OpsEventOf,
  PrinterCommand,
} from "@openprintstack/protocol";

import { formatBytes, formatPercent } from "../printers/format.ts";
import { temperatureText } from "../printers/parts.tsx";
import { STATUS_LABEL } from "../printers/status.ts";

// How the event log puts events into words. A row reads, for example:
//
//   Status changed   Idle → Preparing · Heating up
//   Command requested   Pause the print                    (by rob)
//   Command result      Pause the print: done in 12 ms
//
// The type's label, then a summary of its payload (none where the label says
// it all); the raw event is in the row's Details. Names come from what the
// page knows (`LogContext`): the fleet, the users the log's pages name, and
// the other events loaded.

export const TYPE_LABEL: Record<EventType, string> = {
  "printer.telemetry": "Telemetry",
  "printer.status_changed": "Status changed",
  "printer.capabilities_changed": "Capabilities changed",
  "printer.alert": "Alert",
  "printer.job_started": "Job started",
  "printer.job_ended": "Job ended",
  "printer.files_changed": "Files changed",
  "command.requested": "Command requested",
  "command.result": "Command result",
  "printer.added": "Printer added",
  "printer.updated": "Printer updated",
  "printer.removed": "Printer deleted",
  "auth.setup_completed": "Setup completed",
  "auth.login_succeeded": "Logged in",
  "auth.login_failed": "Login failed",
  "auth.logout": "Logged out",
  "system.started": "Server started",
  "system.stopping": "Server stopping",
};

export const CATEGORY_LABEL: Record<EventCategory, string> = {
  telemetry: "Telemetry",
  state: "Printer state",
  command: "Commands",
  config: "Printer setup",
  auth: "Logins",
  system: "Server",
};

const SEVERITY_LABEL: Record<AlertSeverity, string> = {
  info: "Info",
  warning: "Warning",
  error: "Error",
};

/** What the page knows that an event's ids refer to. */
export type LogContext = {
  /** A heater's or fan's label on a printer, if the printer is known. */
  partLabel(
    printerId: string,
    part: "heaters" | "fans",
    id: string,
  ): string | undefined;
  /** The command a command.result answers, if its request is loaded. */
  request(commandId: string): PrinterCommand | undefined;
};

/** The summary after the type's label, or null when there's nothing to add. */
export function eventSummary(
  event: OpsEvent,
  context: LogContext,
): string | null {
  switch (event.type) {
    case "printer.telemetry":
      return telemetrySummary(event, context);
    case "printer.status_changed": {
      const { previous, status, detail, error } = event.payload;
      const change =
        previous === null
          ? STATUS_LABEL[status]
          : `${STATUS_LABEL[previous]} → ${STATUS_LABEL[status]}`;
      const notes = [detail, error?.message].filter(
        (note, index, all): note is string =>
          note != null && note !== "" && all.indexOf(note) === index,
      );
      return [change, ...notes].join(" · ");
    }
    case "printer.alert":
      return `${SEVERITY_LABEL[event.payload.severity]}: ${event.payload.message}`;
    case "printer.job_started":
      return event.payload.fileName;
    case "printer.job_ended": {
      const { outcome, fileName } = event.payload;
      if (outcome === "completed") return `${fileName} finished`;
      if (outcome === "cancelled") return `${fileName} was cancelled`;
      return `${fileName} failed`;
    }
    case "command.requested":
      return commandText(event.payload.command, event.printerId, context);
    case "command.result":
      return resultSummary(event, context);
    case "printer.added":
      return `${event.payload.name} (${event.payload.driverType})`;
    case "printer.updated": {
      const fields = new Set(event.payload.changedFields);
      const changes = [
        fields.has("name") && "Renamed",
        fields.has("settings") && "Settings changed",
      ].filter((change) => change !== false);
      return changes.length === 0 ? null : changes.join(", ");
    }
    case "printer.removed":
      return event.payload.name;
    case "auth.login_failed":
      return event.payload.username === ""
        ? "No username"
        : `Username “${event.payload.username}”`;
    case "system.started":
      return `Version ${event.payload.version}`;
    case "printer.capabilities_changed":
    case "printer.files_changed":
    case "auth.setup_completed":
    case "auth.login_succeeded":
    case "auth.logout":
    case "system.stopping":
      return null;
  }
}

/** A command in words, e.g. "Pause the print" or "Set Nozzle to 215 °C". */
export function commandText(
  command: PrinterCommand,
  printerId: string,
  context: LogContext,
): string {
  switch (command.kind) {
    case "print.start":
      return `Start ${command.fileName}`;
    case "print.pause":
      return "Pause the print";
    case "print.resume":
      return "Resume the print";
    case "print.cancel":
      return "Cancel the print";
    case "motion.home":
      return command.axes.length === 0
        ? "Home all"
        : `Home ${command.axes.map((axis) => axis.toUpperCase()).join(", ")}`;
    case "motion.move": {
      const moves = (["x", "y", "z"] as const).flatMap((axis) => {
        const mm = command[axis];
        return mm === undefined
          ? []
          : [`${axis.toUpperCase()} ${signed(mm)} mm`];
      });
      const speed =
        command.speedMmS === undefined ? "" : ` at ${command.speedMmS} mm/s`;
      return `Move ${moves.join(", ")}${speed}`;
    }
    case "temperature.set": {
      const heater =
        context.partLabel(printerId, "heaters", command.heaterId) ??
        command.heaterId;
      return command.targetC === 0
        ? `Turn ${heater} off`
        : `Set ${heater} to ${command.targetC} °C`;
    }
    case "fan.set": {
      const fan =
        context.partLabel(printerId, "fans", command.fanId) ?? command.fanId;
      return `Set the ${fan} fan to ${formatPercent(command.percent)}`;
    }
    case "file.upload":
      return `Upload ${command.fileName} (${formatBytes(command.sizeBytes)})`;
    case "extension.invoke":
      return command.extension === "simulator"
        ? simulatorText(command.action, command.params)
        : `${command.extension}: ${command.action}`;
  }
}

/** The simulator's actions, worded like the Simulator panel's toasts. */
function simulatorText(action: string, params: unknown): string {
  const values = typeof params === "object" && params !== null ? params : {};
  switch (action) {
    case "fault.error":
      return "Simulate an error";
    case "fault.filament_runout":
      return "Simulate a filament runout";
    case "fault.disconnect":
      return "durationS" in values && typeof values.durationS === "number"
        ? `Simulate a disconnect for ${values.durationS} s`
        : "Simulate a disconnect";
    case "clear":
      return "Clear the simulated faults";
    case "set_speed":
      return "multiplier" in values && typeof values.multiplier === "number"
        ? `Set the simulation speed to ×${values.multiplier}`
        : "Set the simulation speed";
    default:
      return `simulator: ${action}`;
  }
}

function resultSummary(
  event: OpsEventOf<"command.result">,
  context: LogContext,
): string {
  const { commandId, ok, error, durationMs } = event.payload;
  const request = context.request(commandId);
  const command =
    request === undefined
      ? undefined
      : commandText(request, event.printerId, context);
  if (ok) {
    const done = `done in ${formatMs(durationMs)}`;
    return command === undefined ? capitalise(done) : `${command}: ${done}`;
  }
  const failed = command === undefined ? "Failed" : `${command} failed`;
  return error === undefined ? failed : `${failed}: ${error.message}`;
}

function telemetrySummary(
  event: OpsEventOf<"printer.telemetry">,
  context: LogContext,
): string {
  const { temperatures, job } = event.payload.telemetry;
  const parts = Object.entries(temperatures).map(
    ([id, reading]) =>
      `${context.partLabel(event.printerId, "heaters", id) ?? id} ${temperatureText(reading)}`,
  );
  if (job !== null) {
    parts.push(`${job.fileName} ${formatPercent(job.progressPercent)}`);
  }
  return parts.length === 0 ? "No readings" : parts.join(" · ");
}

/** Who caused an event: a user's name, the printer, or the system. */
export function sourceText(
  source: EventSource,
  users: ReadonlyMap<string, string>,
): string {
  switch (source.kind) {
    case "user":
      return users.get(source.userId) ?? "A user";
    case "driver":
      return "Printer";
    case "system":
      return "System";
  }
}

/** "12 ms", or "2.5 s" from a second. */
export function formatMs(ms: number): string {
  const rounded = Math.round(ms);
  if (rounded < 1000) return `${rounded} ms`;
  return `${(ms / 1000).toLocaleString("en-GB", { maximumFractionDigits: 1 })} s`;
}

/** "+10", "−5" (a minus sign, not a hyphen), "0". */
function signed(mm: number): string {
  if (mm > 0) return `+${mm}`;
  if (mm < 0) return `−${Math.abs(mm)}`;
  return "0";
}

function capitalise(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}
