// SPDX-FileCopyrightText: 2026 Open Print Stack contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { MiddlewareHandler } from "hono";

import type { AppEnv } from "../context.ts";
import { HttpError } from "../errors.ts";

// Cross-site request forgery protection: a request that can change something
// must come from a page on this server's own origin. Browsers send Origin on
// every POST, PUT, PATCH and DELETE, so a request without one isn't from a web
// page, and is let through (curl, scripts). "null", sent by sandboxed frames
// and some privacy settings, never matches. Hono's csrf() only checks form
// content types, so it isn't used.

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * Refuses an unsafe request whose Origin isn't the request's own origin
 * (http:// plus its Host): 403. Through Vite's dev proxy, Host stays the
 * browser's (localhost:5173), so the web app's requests still match.
 */
export function originCheck(): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    if (!SAFE_METHODS.has(c.req.method)) {
      const origin = c.req.header("origin");
      if (origin !== undefined && origin !== new URL(c.req.url).origin) {
        throw new HttpError(
          "origin_not_allowed",
          "Requests from other sites aren't allowed.",
        );
      }
    }
    await next();
  };
}
