// SPDX-FileCopyrightText: 2026 Open Print Stack contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { MiddlewareHandler } from "hono";

import type { Logger } from "../../logger.ts";
import type { AppEnv } from "../context.ts";

/**
 * One debug line per request (component "http"): method, path without the
 * query, status, duration and user id. Cookies are never logged.
 */
export function requestLog(logger: Logger): MiddlewareHandler<AppEnv> {
  const log = logger.child({ component: "http" });
  return async (c, next) => {
    const started = performance.now();
    await next();
    log.debug(
      {
        method: c.req.method,
        path: c.req.path,
        status: c.res.status,
        durationMs: Math.round(performance.now() - started),
        userId: c.var.user?.id ?? null,
      },
      "Request",
    );
  };
}
