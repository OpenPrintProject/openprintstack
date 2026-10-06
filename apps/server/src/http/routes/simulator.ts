// SPDX-FileCopyrightText: 2026 Open Print Stack contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { createRoute } from "@hono/zod-openapi";
import type { JsonValue } from "@openprintstack/protocol";

import {
  SIMULATOR_EXTENSION,
  SimulatorParams,
} from "../../drivers/registry.ts";
import type { SessionEnv } from "../context.ts";
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
import { commandReply } from "./commands.ts";

// The simulated printer's fault panel. Each route is an extension.invoke
// command on the "simulator" extension, answered like any command; the
// bodies are the simulator's own params schemas.

const ErrorParams = SimulatorParams["fault.error"].meta({
  id: "SimulatorErrorParams",
});
const DisconnectParams = SimulatorParams["fault.disconnect"].meta({
  id: "SimulatorDisconnectParams",
});
const SpeedParams = SimulatorParams.set_speed.meta({
  id: "SimulatorSpeedParams",
});

const common = {
  method: "post" as const,
  tags: ["simulator"],
  security: SESSION_SECURITY,
  middleware: requireSession,
  responses: {
    200: jsonResponse(CommandResult, "The simulator did it."),
    ...errorResponses(400, 401, 404, 409, 413, 415, 422, 504),
  },
};

const faultError = createRoute({
  ...common,
  path: "/api/printers/{id}/simulator/faults/error",
  operationId: "simulateError",
  summary: "Put the simulated printer in error",
  description:
    "A running job freezes until clear. The body is optional: null, {} or { message }.",
  request: {
    params: PrinterIdParams,
    body: jsonBody(ErrorParams, { required: false }),
  },
});

const faultFilamentRunout = createRoute({
  ...common,
  path: "/api/printers/{id}/simulator/faults/filament-runout",
  operationId: "simulateFilamentRunout",
  summary: "Run the simulated printer out of filament",
  description:
    "Pauses a running print and raises a filament_runout alert. No body, or null or {}.",
  request: {
    params: PrinterIdParams,
    body: jsonBody(SimulatorParams["fault.filament_runout"], {
      required: false,
    }),
  },
});

const faultDisconnect = createRoute({
  ...common,
  path: "/api/printers/{id}/simulator/faults/disconnect",
  operationId: "simulateDisconnect",
  summary: "Make the simulated printer unreachable for a while",
  description:
    "It goes offline for durationS real seconds (1–3600), then reconnects by itself.",
  request: { params: PrinterIdParams, body: jsonBody(DisconnectParams) },
});

const clear = createRoute({
  ...common,
  path: "/api/printers/{id}/simulator/clear",
  operationId: "simulateClear",
  summary: "Clear the simulated printer's error and disconnect",
  description:
    "Ends an error (failing a frozen job) and any simulated disconnect. Works while offline. No body, or null or {}.",
  request: {
    params: PrinterIdParams,
    body: jsonBody(SimulatorParams.clear, { required: false }),
  },
});

const speed = createRoute({
  ...common,
  path: "/api/printers/{id}/simulator/speed",
  operationId: "simulateSpeed",
  summary: "Change the simulation speed",
  description:
    "Until the driver restarts. The multiplier is 0.1–1000; the speedMultiplier setting is what survives a restart.",
  request: { params: PrinterIdParams, body: jsonBody(SpeedParams) },
});

export function simulatorRoutes() {
  const routes = newRoutes();

  routes.openapi(faultError, async (c) => {
    const { id } = c.req.valid("param");
    const result = await invoke(c.var, id, "fault.error", c.req.valid("json"));
    return c.json(result, 200);
  });
  routes.openapi(faultFilamentRunout, async (c) => {
    const { id } = c.req.valid("param");
    const params = c.req.valid("json");
    const result = await invoke(c.var, id, "fault.filament_runout", params);
    return c.json(result, 200);
  });
  routes.openapi(faultDisconnect, async (c) => {
    const { id } = c.req.valid("param");
    const params = c.req.valid("json");
    const result = await invoke(c.var, id, "fault.disconnect", params);
    return c.json(result, 200);
  });
  routes.openapi(clear, async (c) => {
    const { id } = c.req.valid("param");
    const result = await invoke(c.var, id, "clear", c.req.valid("json"));
    return c.json(result, 200);
  });
  routes.openapi(speed, async (c) => {
    const { id } = c.req.valid("param");
    const result = await invoke(c.var, id, "set_speed", c.req.valid("json"));
    return c.json(result, 200);
  });

  return routes;
}

/** Runs the simulator action as an extension.invoke command. */
async function invoke(
  { deps, user }: SessionEnv["Variables"],
  printerId: string,
  action: keyof typeof SimulatorParams,
  params: JsonValue,
): Promise<CommandResult> {
  const result = await deps.commands.execute({
    printerId,
    command: {
      kind: "extension.invoke",
      extension: SIMULATOR_EXTENSION,
      action,
      params,
    },
    userId: user.id,
  });
  return commandReply(result);
}
