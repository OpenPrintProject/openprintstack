// SPDX-FileCopyrightText: 2026 Open Print Stack contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

// The conformance kit is at "@openprintstack/driver-sdk/testing", so that
// nothing here loads Vitest.

export {
  type CallOptions,
  DriverClient,
  type DriverClientOptions,
  DriverProtocolError,
} from "./client.ts";
export {
  defineDriver,
  type DriverContext,
  type DriverInit,
  type DriverLogger,
  DriverManifest,
  type DriverModule,
  type HomeRequest,
  type InvokeExtensionRequest,
  ListCamerasResult,
  ListFilesResult,
  type MoveRequest,
  type PrinterDriver,
  type SendFileRequest,
  type SetFanRequest,
  type SetTemperatureRequest,
  type SettingsSchema,
  Snapshot,
  type SnapshotRequest,
  type StartPrintRequest,
} from "./contract.ts";
export { dispatch, type UncheckedRequest } from "./dispatch.ts";
export {
  type DriverEndpoint,
  serveDriver,
  type ServeDriverOptions,
} from "./endpoint.ts";
export {
  DriverError,
  DriverErrorCode,
  DriverErrorInfo,
  toDriverError,
} from "./errors.ts";
export {
  DriverAlertMessage,
  DriverCapabilitiesMessage,
  DriverFilesChangedMessage,
  DriverJobLifecycleMessage,
  DriverJobMessage,
  DriverLogMessage,
  DriverMessage,
  type DriverMessageOf,
  DriverStatusMessage,
  DriverTelemetryMessage,
  JobLifecycleEvent,
  LogData,
  LogLevel,
  TelemetryPatch,
} from "./messages.ts";
export {
  callForCommand,
  DRIVER_OP_RESULTS,
  DRIVER_OPS,
  type DriverArgs,
  type DriverCall,
  type DriverOp,
  type DriverResult,
  type EmptyArgs,
  isDriverOp,
  type WireResult,
} from "./ops.ts";
export { assertSerializable, findUnserializable } from "./serializable.ts";
export { defaultSettings, settingsJsonSchema } from "./settings.ts";
export { reduceTelemetry } from "./telemetry.ts";
export {
  createLoopbackTransport,
  type DriverSideTransport,
  type DriverTransport,
  type HostTransport,
  type LoopbackOptions,
} from "./transport.ts";
export {
  type DriverEmit,
  type DriverRequest,
  type DriverResponse,
  type DriverToHostMessage,
  DriverToHostEnvelope,
  type HostToDriverMessage,
  RequestEnvelope,
} from "./wire.ts";
