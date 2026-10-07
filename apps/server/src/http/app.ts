// SPDX-FileCopyrightText: 2026 Open Print Stack contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { OpenAPIHono } from "@hono/zod-openapi";

import { wsRoutes } from "../ws/route.ts";
import type { AppDeps, AppEnv } from "./context.ts";
import { errorHandler, notFoundHandler } from "./errors.ts";
import { jsonBodyLimit } from "./middleware/body-limit.ts";
import { hostCheck } from "./middleware/host.ts";
import { originCheck } from "./middleware/origin.ts";
import { requestLog } from "./middleware/request-log.ts";
import { securityHeaders } from "./middleware/security-headers.ts";
import { OPENAPI_PATH, openApiDocument } from "./openapi.ts";
import { apiRoutes } from "./routes/index.ts";
import { newRoutes } from "./validation.ts";
import { webRoutes } from "./web.ts";

// The HTTP app, without a socket: server.ts serves it with @hono/node-server,
// which also hands it the WebSocket upgrades at /api/ws. Every request passes
//
//   request log → security headers → Host check → Origin check (unsafe
//   methods) → 64 KiB body limit (not uploads) → the route: session (most
//   routes) → schema checks (400) → handler
//
// and every error is answered as an ApiError (errors.ts). GETs outside /api
// are the web app's pages (web.ts), after every API route.

export type { AppDeps, AppEnv } from "./context.ts";

export function createApp(deps: AppDeps): OpenAPIHono<AppEnv> {
  const app = newRoutes();
  app.onError(errorHandler(deps.logger));
  app.notFound(notFoundHandler);

  app.use(requestLog(deps.logger));
  app.use(securityHeaders());
  app.use(hostCheck(deps.config));
  app.use(originCheck());
  app.use(jsonBodyLimit());
  app.use(async (c, next) => {
    c.set("deps", deps);
    await next();
  });

  app.get(OPENAPI_PATH, (c) => c.json(openApiDocument()));
  app.route("/", apiRoutes());
  app.route("/", wsRoutes());
  app.route("/", webRoutes(deps.web));
  return app;
}
