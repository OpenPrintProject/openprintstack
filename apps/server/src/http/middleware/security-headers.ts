// SPDX-FileCopyrightText: 2026 Open Print Stack contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { MiddlewareHandler } from "hono";
import { secureHeaders } from "hono/secure-headers";

import type { AppEnv } from "../context.ts";

// Hono's secureHeaders(), with these changes:
//  - no Strict-Transport-Security: it means nothing over plain HTTP, and
//    Phase 8 adds it with HTTPS
//  - Referrer-Policy: same-origin, not no-referrer. A page served with
//    no-referrer makes the browser send "Origin: null" on its own POSTs, which
//    the Origin check refuses.
//  - API responses also get a Content-Security-Policy that allows nothing,
//    and Cache-Control: no-store.
//  - Pages (everything outside /api) get a Content-Security-Policy that allows
//    this server's own scripts, styles, images, fonts and connections (the
//    WebSocket included), and X-Frame-Options: DENY. Styles also allow
//    'unsafe-inline': sonner (the toasts) and react-remove-scroll (open
//    dialogs) add <style> elements at run time, and sonner can't take a nonce.
// The WebSocket upgrade at /api/ws gets none of them.

export const WS_PATH = "/api/ws";

/** The API's paths: /api and everything under it. */
export function isApiPath(path: string): boolean {
  return path === "/api" || path.startsWith("/api/");
}

const BASE = {
  strictTransportSecurity: false,
  referrerPolicy: "same-origin",
} as const;

export function securityHeaders(): MiddlewareHandler<AppEnv> {
  const page = secureHeaders({
    ...BASE,
    contentSecurityPolicy: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'"],
      fontSrc: ["'self'"],
      // 'self' covers the page's own ws:// socket.
      connectSrc: ["'self'"],
      objectSrc: ["'none'"],
      baseUri: ["'none'"],
      formAction: ["'self'"],
      frameAncestors: ["'none'"],
    },
    xFrameOptions: "DENY",
  });
  const api = secureHeaders({
    ...BASE,
    contentSecurityPolicy: {
      defaultSrc: ["'none'"],
      frameAncestors: ["'none'"],
    },
  });
  return async (c, next) => {
    if (c.req.path === WS_PATH) {
      await next();
      return;
    }
    if (!isApiPath(c.req.path)) {
      await page(c, next);
      return;
    }
    await api(c, async () => {
      await next();
      c.res.headers.set("Cache-Control", "no-store");
    });
  };
}
