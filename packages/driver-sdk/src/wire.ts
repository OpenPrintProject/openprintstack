// SPDX-FileCopyrightText: 2026 Open Print Stack contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { z } from "zod";

import { DriverErrorInfo } from "./errors.ts";
import { DriverMessage } from "./messages.ts";
import type { DriverArgs, DriverOp, WireResult } from "./ops.ts";

// The messages that cross a DriverTransport. The host sends requests; the
// driver answers each with a response, and sends `message`s (from ctx.emit)
// whenever it likes:
//
//   host → driver  { type: "request", id: 7, op: "setFan", args: { … } }
//   driver → host  { type: "response", id: 7, ok: true, result: null }
//   driver → host  { type: "response", id: 8, ok: false, error: { code, message } }
//   driver → host  { type: "message", message: { type: "telemetry", … } }

export type DriverRequest = {
  [Op in DriverOp]: {
    type: "request";
    /** Unique per client; the response carries it back. */
    id: number;
    op: Op;
    args: DriverArgs<Op>;
  };
}[DriverOp];

export type DriverResponse =
  | {
      type: "response";
      id: number;
      ok: true;
      result: { [Op in DriverOp]: WireResult<Op> }[DriverOp];
    }
  | { type: "response"; id: number; ok: false; error: DriverErrorInfo };

export type DriverEmit = {
  type: "message";
  message: DriverMessage;
};

export type HostToDriverMessage = DriverRequest;

export type DriverToHostMessage = DriverResponse | DriverEmit;

const RequestId = z.int().nonnegative();

/**
 * What the driver endpoint checks before dispatching: the envelope only. Args
 * come from host code that has already parsed the command, so they aren't
 * parsed again, and an unknown `op` is dispatch's job (`not_supported`).
 */
export const RequestEnvelope = z.object({
  type: z.literal("request"),
  id: RequestId,
  op: z.string(),
  args: z.record(z.string(), z.unknown()),
});

/**
 * What the host's client parses every incoming message with. A response's
 * `result` is parsed afterwards, against the schema for the request's op.
 */
export const DriverToHostEnvelope = z.discriminatedUnion("type", [
  z.discriminatedUnion("ok", [
    z.object({
      type: z.literal("response"),
      id: RequestId,
      ok: z.literal(true),
      result: z.unknown(),
    }),
    z.object({
      type: z.literal("response"),
      id: RequestId,
      ok: z.literal(false),
      error: DriverErrorInfo,
    }),
  ]),
  z.object({ type: z.literal("message"), message: DriverMessage }),
]);
