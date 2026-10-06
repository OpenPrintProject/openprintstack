// SPDX-FileCopyrightText: 2026 Open Print Stack contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { type Hook, OpenAPIHono } from "@hono/zod-openapi";
import { z } from "zod";

import type { AppEnv } from "./context.ts";
import { asJson, HttpError } from "./errors.ts";

/** What the request part a validator checked is called in messages. */
const PART: Readonly<Record<string, string>> = {
  json: "body",
  form: "body",
  query: "query",
  param: "path",
  header: "headers",
  cookie: "cookies",
};

/**
 * @hono/zod-openapi's defaultHook: a request that fails its schema is 400
 * validation_failed, with Zod's summary in the message and its issues as the
 * details. Issues never include the input, so a password isn't echoed back.
 */
export const validationHook: Hook<unknown, AppEnv, string, unknown> = (
  result,
) => {
  if (result.success) return;
  const part = PART[result.target] ?? result.target;
  throw new HttpError(
    "validation_failed",
    `The request ${part} isn't valid. ${z.prettifyError(result.error)}`,
    { details: asJson(result.error.issues) },
  );
};

/** A new set of routes, answering invalid requests with `validationHook`. */
export function newRoutes(): OpenAPIHono<AppEnv> {
  return new OpenAPIHono<AppEnv>({ defaultHook: validationHook });
}
