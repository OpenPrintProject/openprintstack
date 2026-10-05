// SPDX-FileCopyrightText: 2026 Open Print Stack contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

// Sample values for the tests: one of every command, event and message.

import type { ApiError } from "./api.ts";
import type { Camera } from "./cameras.ts";
import type { Capabilities } from "./capabilities.ts";
import type { CommandKind, PrinterCommandOf } from "./commands.ts";
import type { EventType, OpsEventOf } from "./events.ts";
import type { PrinterFile } from "./files.ts";
import type { PrinterSnapshot } from "./state.ts";
import type { Telemetry } from "./telemetry.ts";
import type { WsClientMessage, WsServerMessage } from "./ws.ts";

export const TS = "2026-10-05T12:00:00.000Z";
export const BOOT_ID = "0199b3a0-1c00-7000-8000-00000000b001";
export const PRINTER_ID = "printer-1";
export const USER_ID = "0199b3a0-1c00-7000-8000-00000000a001";
export const COMMAND_ID = "0199b3a0-1c00-7000-8000-00000000c001";

/** A valid UUIDv7 that is unique per `n`. */
export function eventId(n: number): string {
  return `0199b3a0-1c00-7000-8000-${n.toString(16).padStart(12, "0")}`;
}

export const capabilitiesFixture: Capabilities = {
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
  heaters: [
    { id: "nozzle", kind: "nozzle", label: "Nozzle", maxC: 300 },
    { id: "bed", kind: "bed", label: "Bed", maxC: 120 },
  ],
  fans: [
    { id: "part", kind: "part", label: "Part cooling", controllable: true },
  ],
  axes: {
    x: { minMm: 0, maxMm: 256 },
    y: { minMm: 0, maxMm: 256 },
    z: { minMm: 0, maxMm: 256 },
  },
  maxMoveSpeedMmS: 200,
  files: {
    list: true,
    upload: true,
    acceptedExtensions: [".gcode"],
    maxUploadBytes: null,
  },
  cameras: { snapshot: true, stream: false },
  extensions: ["simulator"],
};

export const telemetryFixture: Telemetry = {
  temperatures: {
    nozzle: { actualC: 214.6, targetC: 215 },
    bed: { actualC: 59.8, targetC: 60 },
  },
  fans: { part: { percent: 100 } },
  speedPercent: 150,
  position: { x: 120.5, y: 88, z: 2.4 },
  homedAxes: ["x", "y", "z"],
  job: {
    fileName: "benchy.gcode",
    progressPercent: 42.5,
    elapsedS: 255,
    remainingS: null,
    currentLayer: 12,
    totalLayers: null,
  },
};

export const commandFixtures: { [K in CommandKind]: PrinterCommandOf<K> } = {
  "print.start": { kind: "print.start", fileName: "benchy.gcode" },
  "print.pause": { kind: "print.pause" },
  "print.resume": { kind: "print.resume" },
  "print.cancel": { kind: "print.cancel" },
  "motion.home": { kind: "motion.home", axes: [] },
  "motion.move": { kind: "motion.move", x: -10, z: 0.2, speedMmS: 50 },
  "temperature.set": {
    kind: "temperature.set",
    heaterId: "nozzle",
    targetC: 215,
  },
  "fan.set": { kind: "fan.set", fanId: "part", percent: 50 },
  "file.upload": {
    kind: "file.upload",
    stagedFileId: "staged-1",
    fileName: "benchy.gcode",
    sizeBytes: 1_234_567,
  },
  "extension.invoke": {
    kind: "extension.invoke",
    extension: "simulator",
    action: "fault.disconnect",
    params: { durationS: 15, note: null, tags: ["a", 1, true] },
  },
};

const driver = { kind: "driver" } as const;
const user = { kind: "user", userId: USER_ID } as const;
const system = { kind: "system" } as const;

function base(seq: number) {
  return { id: eventId(seq), ts: TS, seq, bootId: BOOT_ID };
}

export const eventFixtures: { [T in EventType]: OpsEventOf<T> } = {
  "printer.telemetry": {
    ...base(1),
    printerId: PRINTER_ID,
    type: "printer.telemetry",
    category: "telemetry",
    source: driver,
    correlationId: null,
    payload: { telemetry: telemetryFixture },
  },
  "printer.status_changed": {
    ...base(2),
    printerId: PRINTER_ID,
    type: "printer.status_changed",
    category: "state",
    source: driver,
    correlationId: null,
    payload: {
      previous: "printing",
      status: "error",
      detail: "Thermal runaway",
      error: { code: "thermal_runaway", message: "Nozzle heater failed." },
    },
  },
  "printer.capabilities_changed": {
    ...base(3),
    printerId: PRINTER_ID,
    type: "printer.capabilities_changed",
    category: "state",
    source: driver,
    correlationId: null,
    payload: { capabilities: capabilitiesFixture },
  },
  "printer.alert": {
    ...base(4),
    printerId: PRINTER_ID,
    type: "printer.alert",
    category: "state",
    source: driver,
    correlationId: null,
    payload: {
      severity: "warning",
      code: "filament_runout",
      message: "Filament ran out. The print is paused.",
    },
  },
  "printer.job_started": {
    ...base(5),
    printerId: PRINTER_ID,
    type: "printer.job_started",
    category: "state",
    source: driver,
    correlationId: null,
    payload: { fileName: "benchy.gcode" },
  },
  "printer.job_ended": {
    ...base(6),
    printerId: PRINTER_ID,
    type: "printer.job_ended",
    category: "state",
    source: driver,
    correlationId: null,
    payload: { outcome: "completed", fileName: "benchy.gcode" },
  },
  "printer.files_changed": {
    ...base(7),
    printerId: PRINTER_ID,
    type: "printer.files_changed",
    category: "state",
    source: driver,
    correlationId: null,
    payload: {},
  },
  "command.requested": {
    ...base(8),
    printerId: PRINTER_ID,
    type: "command.requested",
    category: "command",
    source: user,
    correlationId: COMMAND_ID,
    payload: {
      commandId: COMMAND_ID,
      command: commandFixtures["temperature.set"],
    },
  },
  "command.result": {
    ...base(9),
    printerId: PRINTER_ID,
    type: "command.result",
    category: "command",
    source: user,
    correlationId: COMMAND_ID,
    payload: {
      commandId: COMMAND_ID,
      ok: false,
      error: {
        code: "unsafe",
        message: "400 °C is above the nozzle's 300 °C.",
      },
      durationMs: 3,
    },
  },
  "printer.added": {
    ...base(10),
    printerId: PRINTER_ID,
    type: "printer.added",
    category: "config",
    source: user,
    correlationId: null,
    payload: { name: "Sim 1", driverType: "simulated" },
  },
  "printer.updated": {
    ...base(11),
    printerId: PRINTER_ID,
    type: "printer.updated",
    category: "config",
    source: user,
    correlationId: null,
    payload: { changedFields: ["name", "settings"] },
  },
  "printer.removed": {
    ...base(12),
    printerId: PRINTER_ID,
    type: "printer.removed",
    category: "config",
    source: user,
    correlationId: null,
    payload: { name: "Sim 1" },
  },
  "auth.setup_completed": {
    ...base(13),
    printerId: null,
    type: "auth.setup_completed",
    category: "auth",
    source: user,
    correlationId: null,
    payload: {},
  },
  "auth.login_succeeded": {
    ...base(14),
    printerId: null,
    type: "auth.login_succeeded",
    category: "auth",
    source: user,
    correlationId: null,
    payload: {},
  },
  "auth.login_failed": {
    ...base(15),
    printerId: null,
    type: "auth.login_failed",
    category: "auth",
    source: system,
    correlationId: null,
    payload: { username: "admin" },
  },
  "auth.logout": {
    ...base(16),
    printerId: null,
    type: "auth.logout",
    category: "auth",
    source: user,
    correlationId: null,
    payload: {},
  },
  "system.started": {
    ...base(17),
    printerId: null,
    type: "system.started",
    category: "system",
    source: system,
    correlationId: null,
    payload: { version: "0.0.0" },
  },
  "system.stopping": {
    ...base(18),
    printerId: null,
    type: "system.stopping",
    category: "system",
    source: system,
    correlationId: null,
    payload: {},
  },
};

export const snapshotFixture: PrinterSnapshot = {
  printer: { id: PRINTER_ID, name: "Sim 1", driverType: "simulated" },
  state: {
    status: "printing",
    statusDetail: null,
    error: null,
    telemetry: telemetryFixture,
    capabilities: capabilitiesFixture,
    updatedAt: TS,
  },
  seq: 42,
};

export const wsClientMessageFixtures: WsClientMessage[] = [
  { type: "subscribe", topic: { name: "fleet" } },
  { type: "subscribe", topic: { name: "printer", printerId: PRINTER_ID } },
  {
    type: "subscribe",
    topic: {
      name: "events",
      printerId: PRINTER_ID,
      types: ["command.requested", "command.result"],
      includeTelemetry: false,
    },
  },
  { type: "unsubscribe", topic: { name: "events" } },
  { type: "ping" },
];

export const wsServerMessageFixtures: WsServerMessage[] = [
  {
    type: "hello",
    bootId: BOOT_ID,
    user: { id: USER_ID, username: "admin" },
  },
  {
    type: "snapshot",
    topic: { name: "fleet" },
    seq: 42,
    data: [snapshotFixture],
  },
  {
    type: "snapshot",
    topic: { name: "printer", printerId: PRINTER_ID },
    seq: 42,
    data: snapshotFixture,
  },
  { type: "snapshot", topic: { name: "events" }, seq: 42, data: null },
  {
    type: "event",
    topic: { name: "printer", printerId: PRINTER_ID },
    event: eventFixtures["printer.telemetry"],
  },
  { type: "error", code: "unknown_printer", message: "No such printer." },
  { type: "pong" },
];

export const apiErrorFixture: ApiError = {
  error: {
    code: "validation_failed",
    message: "The request body is invalid.",
    details: [{ path: ["targetC"], message: "Too small" }],
  },
};

export const printerFileFixtures: PrinterFile[] = [
  { name: "benchy.gcode", sizeBytes: 1_234_567, modifiedAt: TS },
  { name: "calibration cube.gcode", sizeBytes: null, modifiedAt: null },
];

export const cameraFixture: Camera = { id: "chamber", label: "Chamber" };
