// SPDX-FileCopyrightText: 2026 Open Print Stack contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { MiddlewareHandler } from "hono";
import { bodyLimit } from "hono/body-limit";

import type { AppEnv } from "../context.ts";
import { HttpError } from "../errors.ts";

/** The largest JSON body any route takes. */
export const JSON_BODY_LIMIT = 64 * 1024;

/** File uploads stream to disk and have their own size rule. */
const UPLOAD_PATH = /^\/api\/printers\/[^/]+\/files\/[^/]+$/;

/**
 * Refuses a body over 64 KiB with 413 payload_too_large, except on the upload
 * route. A body with a Content-Length is refused before it's read; one without
 * is counted as it arrives.
 */
export function jsonBodyLimit(): MiddlewareHandler<AppEnv> {
  const limit = bodyLimit({
    maxSize: JSON_BODY_LIMIT,
    onError: () => {
      throw new HttpError(
        "payload_too_large",
        `The body is over the ${JSON_BODY_LIMIT / 1024} KiB limit.`,
      );
    },
  });
  return async (c, next) => {
    if (c.req.method === "PUT" && UPLOAD_PATH.test(c.req.path)) {
      await next();
      return;
    }
    await limit(c, next);
  };
}
