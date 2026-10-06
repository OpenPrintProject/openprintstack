// SPDX-FileCopyrightText: 2026 Open Print Stack contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { MiddlewareHandler } from "hono";
import { secureHeaders } from "hono/secure-headers";

import type { AppEnv } from "../context.ts";

// Hono's secureHeaders(), with three changes:
//  - no Strict-Transport-Security: it means nothing over plain HTTP, and
//    Phase 8 adds it with HTTPS
//  - Referrer-Policy: same-origin, not no-referrer. A page served with
//    no-referrer makes the browser send "Origin: null" on its own POSTs, which
//    the Origin check refuses.
//  - API responses also get a Content-Security-Policy that allows nothing,
//    and Cache-Control: no-store.
// The WebSocket upgrade at /api/ws gets none of them.

export const WS_PATH = "/api/ws";

const BASE = {
  strictTransportSecurity: false,
  referrerPolicy: "same-origin",
} as const;

export function securityHeaders(): MiddlewareHandler<AppEnv> {
  const page = secureHeaders(BASE);
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
    if (!c.req.path.startsWith("/api/")) {
      await page(c, next);
      return;
    }
    await api(c, async () => {
      await next();
      c.res.headers.set("Cache-Control", "no-store");
    });
  };
}
