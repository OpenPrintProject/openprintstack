// SPDX-FileCopyrightText: 2026 Open Print Stack contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { OpenAPIHono } from "@hono/zod-openapi";

import type { AppEnv } from "../context.ts";
import { newRoutes } from "../validation.ts";
import { authRoutes } from "./auth.ts";
import { cameraRoutes } from "./cameras.ts";
import { commandRoutes } from "./commands.ts";
import { eventRoutes } from "./events.ts";
import { fileRoutes } from "./files.ts";
import { printerRoutes } from "./printers.ts";
import { simulatorRoutes } from "./simulator.ts";

/**
 * Every /api route, each with its schemas. They read their services from
 * `c.var.deps`, so building them needs none: the OpenAPI spec is made from
 * this alone.
 */
export function apiRoutes(): OpenAPIHono<AppEnv> {
  const api = newRoutes();
  for (const routes of [
    authRoutes(),
    printerRoutes(),
    commandRoutes(),
    fileRoutes(),
    cameraRoutes(),
    simulatorRoutes(),
    eventRoutes(),
  ]) {
    api.route("/", routes);
  }
  return api;
}
