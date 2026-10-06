// SPDX-FileCopyrightText: 2026 Open Print Stack contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { MiddlewareHandler } from "hono";

import { type Config, normalizeHostName } from "../../config.ts";
import type { AppEnv } from "../context.ts";
import { HttpError } from "../errors.ts";

// Every request's Host must be a name the server knows it has. This stops DNS
// rebinding: a site that points its own domain at 127.0.0.1 would otherwise
// have the browser talk to this server as that domain, with an Origin that
// matches, and could call setup on a fresh install.

const LOOPBACK = ["localhost", "127.0.0.1", "[::1]"];

/** Addresses that mean "every interface", which no request is sent to. */
const WILDCARDS = new Set(["0.0.0.0", "[::]"]);

/**
 * The host names the server answers to, normalised as `URL.hostname`:
 * loopback, OPS_HOST (unless it's a wildcard) and OPS_ALLOWED_HOSTS.
 */
export function allowedHostNames(
  config: Pick<Config, "host" | "allowedHosts">,
): ReadonlySet<string> {
  const names = new Set(LOOPBACK);
  const own = normalizeHostName(config.host);
  if (own !== undefined && !WILDCARDS.has(own)) names.add(own);
  for (const host of config.allowedHosts) names.add(host);
  return names;
}

/** Refuses a request whose Host isn't allowed, at any port: 403. */
export function hostCheck(
  config: Pick<Config, "host" | "allowedHosts">,
): MiddlewareHandler<AppEnv> {
  const allowed = allowedHostNames(config);
  return async (c, next) => {
    // @hono/node-server builds the URL from the Host header.
    const host = new URL(c.req.url).hostname;
    if (!allowed.has(host)) {
      throw new HttpError(
        "host_not_allowed",
        `This server doesn't answer to "${host}". To reach it by that name, add the name to OPS_ALLOWED_HOSTS.`,
      );
    }
    await next();
  };
}
