// SPDX-FileCopyrightText: 2026 Open Print Stack contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

// The OpenAPI spec (generated from these schemas by @hono/zod-openapi) names
// its components after each schema's `.meta({ id })`.

import { describe, expect, it } from "vitest";
import { z } from "zod";

import {
  ApiError,
  Camera,
  OpsEvent,
  PrinterCommand,
  PrinterFile,
  PrinterSnapshot,
  WsClientMessage,
  WsServerMessage,
} from "./index.ts";

describe("JSON Schema", () => {
  it("converts every top-level schema, with each id defined once", () => {
    const all = z.object({
      ApiError,
      Camera,
      OpsEvent,
      PrinterCommand,
      PrinterFile,
      PrinterSnapshot,
      WsClientMessage,
      WsServerMessage,
    });

    // z.toJSONSchema throws if two different schemas share an id.
    const definitions = Object.keys(z.toJSONSchema(all).$defs ?? {});

    expect(definitions).toEqual(
      expect.arrayContaining([
        "ApiError",
        "Camera",
        "Capabilities",
        "CommandKind",
        "EventType",
        "MotionMoveCommand",
        "OpsEvent",
        "PrinterCommand",
        "PrinterFile",
        "PrinterSnapshot",
        "PrinterState",
        "PrinterStatus",
        "PrinterTelemetryEvent",
        "Telemetry",
        "Topic",
        "WsClientMessage",
        "WsServerMessage",
      ]),
    );
  });
});
