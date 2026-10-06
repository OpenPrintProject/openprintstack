// SPDX-FileCopyrightText: 2026 Open Print Stack contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { createRoute } from "@hono/zod-openapi";
import { Camera, Id } from "@openprintstack/protocol";
import { z } from "zod";

import { requireSession } from "../middleware/session.ts";
import {
  errorResponses,
  jsonResponse,
  PrinterIdParams,
  SESSION_SECURITY,
} from "../schemas.ts";
import { newRoutes } from "../validation.ts";

// A printer's cameras and their snapshots. A snapshot is served as the image
// itself, from this origin, so the driver's mimeType must be an image type and
// never SVG (driver-sdk checks it) and the browser must not guess another.

const listCameras = createRoute({
  method: "get",
  path: "/api/printers/{id}/cameras",
  operationId: "listCameras",
  tags: ["cameras"],
  summary: "A printer's cameras",
  security: SESSION_SECURITY,
  middleware: requireSession,
  request: { params: PrinterIdParams },
  responses: {
    200: jsonResponse(
      z.object({ cameras: z.array(Camera) }),
      "The printer's cameras.",
    ),
    ...errorResponses(400, 401, 404, 409, 422, 504),
  },
});

const getSnapshot = createRoute({
  method: "get",
  path: "/api/printers/{id}/cameras/{cameraId}/snapshot",
  operationId: "getSnapshot",
  tags: ["cameras"],
  summary: "A snapshot from a camera",
  security: SESSION_SECURITY,
  middleware: requireSession,
  request: {
    params: z.object({
      id: Id.meta({ description: "The printer's id." }),
      cameraId: Id.meta({ description: "The camera's id." }),
    }),
  },
  responses: {
    200: {
      description:
        "The image, with the Content-Type the driver gave. Never cached.",
      content: {
        "image/*": { schema: { type: "string", contentMediaType: "image/*" } },
      },
    },
    ...errorResponses(400, 401, 404, 409, 422, 504),
  },
});

export function cameraRoutes() {
  const routes = newRoutes();

  routes.openapi(listCameras, async (c) => {
    const { id } = c.req.valid("param");
    const { cameras } = await c.var.deps.printers.listCameras(id);
    return c.json({ cameras }, 200);
  });

  routes.openapi(getSnapshot, async (c) => {
    const { id, cameraId } = c.req.valid("param");
    const snapshot = await c.var.deps.printers.getSnapshot(id, cameraId);
    return c.body(new Uint8Array(snapshot.data), 200, {
      "Content-Type": snapshot.mimeType,
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "no-store",
    });
  });

  return routes;
}
