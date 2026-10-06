// SPDX-FileCopyrightText: 2026 Open Print Stack contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { createRoute } from "@hono/zod-openapi";
import {
  ExtensionInvokeCommand,
  FanSetCommand,
  MotionHomeCommand,
  MotionMoveCommand,
  PrintCancelCommand,
  PrintPauseCommand,
  PrintResumeCommand,
  PrintStartCommand,
  TemperatureSetCommand,
} from "@openprintstack/protocol";
import { z } from "zod";

import type { CommandResult as ServiceResult } from "../../commands/command-service.ts";
import { HttpError, isApiErrorCode } from "../errors.ts";
import { requireSession } from "../middleware/session.ts";
import {
  CommandResult,
  errorResponses,
  jsonBody,
  jsonResponse,
  PrinterIdParams,
  SESSION_SECURITY,
} from "../schemas.ts";
import { newRoutes } from "../validation.ts";

// Commands from the user. file.upload isn't one of them: only the server
// creates it, after receiving an upload (files.ts).

/** protocol's PrinterCommand without file.upload. */
export const UserCommand = z
  .discriminatedUnion("kind", [
    PrintStartCommand,
    PrintPauseCommand,
    PrintResumeCommand,
    PrintCancelCommand,
    MotionHomeCommand,
    MotionMoveCommand,
    TemperatureSetCommand,
    FanSetCommand,
    ExtensionInvokeCommand,
  ])
  .meta({
    id: "UserCommand",
    description: "Any command except file.upload, which only uploads create.",
  });

/**
 * A successful command's reply. A refused or failed one throws the HTTP
 * error for its code, with the command's id and duration as details.
 */
export function commandReply(result: ServiceResult): CommandResult {
  if (result.ok) {
    return {
      commandId: result.commandId,
      ok: true,
      durationMs: result.durationMs,
    };
  }
  const code = result.error?.code ?? "internal";
  throw new HttpError(
    // The service only reports codes from commands/errors.ts.
    isApiErrorCode(code) ? code : "internal",
    result.error?.message ?? "The command failed.",
    { details: { commandId: result.commandId, durationMs: result.durationMs } },
  );
}

const runCommand = createRoute({
  method: "post",
  path: "/api/printers/{id}/commands",
  operationId: "runCommand",
  tags: ["commands"],
  summary: "Run a command",
  description:
    "Answers once the printer has done it, or refused. Publishes command.requested and command.result. One command at a time per printer: another gets 409 printer_busy straight away.",
  security: SESSION_SECURITY,
  middleware: requireSession,
  request: { params: PrinterIdParams, body: jsonBody(UserCommand) },
  responses: {
    200: jsonResponse(CommandResult, "The command succeeded."),
    ...errorResponses(400, 401, 404, 409, 413, 415, 422, 504),
  },
});

export function commandRoutes() {
  const routes = newRoutes();

  routes.openapi(runCommand, async (c) => {
    const { deps, user } = c.var;
    const { id } = c.req.valid("param");
    const command = c.req.valid("json");
    const result = await deps.commands.execute({
      printerId: id,
      command,
      userId: user.id,
    });
    return c.json(commandReply(result), 200);
  });

  return routes;
}
