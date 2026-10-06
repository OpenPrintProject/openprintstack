// SPDX-FileCopyrightText: 2026 Open Print Stack contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { upgradeWebSocket, type WebSocketLike } from "@hono/node-server";
import type { OpenAPIHono } from "@hono/zod-openapi";
import type { WebSocket } from "ws";

import type { AppEnv } from "../http/context.ts";
import { HttpError } from "../http/errors.ts";
import { requireOrigin } from "../http/middleware/origin.ts";
import { WS_PATH } from "../http/middleware/security-headers.ts";
import { requireSession } from "../http/middleware/session.ts";
import { newRoutes } from "../http/validation.ts";
import type { HubConnection, HubSocket } from "./hub.ts";

// GET /api/ws. The app's middleware has already checked the Host; this adds
//
//   Origin (required: 403) → session (401) → Upgrade: websocket (426)
//
// then hands the socket to the hub. A refused upgrade is answered with just
// the status: @hono/node-server drops the body, and browsers show pages only
// close code 1006. The upgrade isn't in the OpenAPI spec; protocol's
// WsClientMessage and WsServerMessage describe what goes over it.

export function wsRoutes(): OpenAPIHono<AppEnv> {
  const routes = newRoutes();
  routes.get(WS_PATH, requireOrigin(), requireSession, (c) => {
    const { deps, user, sessionId } = c.var;
    if (c.req.header("upgrade")?.toLowerCase() !== "websocket") {
      throw new HttpError(
        "upgrade_required",
        "This is the WebSocket endpoint: connect to it with a WebSocket client.",
        { headers: { Upgrade: "websocket" } },
      );
    }
    const log = deps.logger.child({ component: "ws" });
    // When the upgrade slides the session, requireSession sends the cookie
    // again, and it belongs on the 101. Hono copies headers set earlier onto
    // the Response a handler returns only if `c.res` exists by then, and
    // reading it creates it. @hono/node-server writes them on the 101.
    void c.res;
    let connection: HubConnection | undefined;
    return upgradeWebSocket(c, {
      onOpen: (_event, ws) => {
        connection = deps.hub.open(hubSocket(ws.raw), { user, sessionId });
      },
      onMessage: (event: { data: unknown }) => {
        connection?.receive(event.data);
      },
      onClose: (event) => {
        connection?.closed(event.code);
      },
      onError: (event) => {
        // e.g. a message over the 64 KiB limit, which `ws` closes with 1009.
        log.debug(
          { err: (event as ErrorEvent).error, userId: user.id },
          "WebSocket error",
        );
      },
    });
  });
  return routes;
}

/** The `ws` WebSocket that @hono/node-server types as its own minimal one. */
function hubSocket(raw: WebSocketLike | undefined): HubSocket {
  if (raw === undefined) {
    throw new Error("@hono/node-server opened a socket without its WebSocket.");
  }
  return raw as unknown as WebSocket;
}
