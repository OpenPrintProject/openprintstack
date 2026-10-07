// SPDX-FileCopyrightText: 2026 Open Print Stack contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { existsSync } from "node:fs";
import path from "node:path";

import { serveStatic } from "@hono/node-server/serve-static";
import { Hono, type MiddlewareHandler } from "hono";

import type { RuntimeEnv } from "../config.ts";
import type { AppEnv } from "./context.ts";
import { isApiPath } from "./middleware/security-headers.ts";

// The web app's pages: every GET (and HEAD) outside /api. In production the
// server serves the build that `pnpm build` writes to apps/web/dist:
//
//   a file in the build   that file. Under /assets/, where Vite names each
//                         file by a hash of its contents, it's cached for a
//                         year; anything else (index.html, licenses.txt) is
//                         checked again on every load
//   /assets/<not there>   404, so an old tab asking for a chunk from before
//                         a rebuild gets an error rather than HTML
//   anything else         index.html, and the app's router takes it from
//                         there (a reload on /events?types=…, say)
//
// Without a build, pages say how to make one (503). In development Vite
// serves the app on its own port, and pages here say so, even when an
// older build is lying around. Other methods outside /api, and every
// unknown /api path, get the API's JSON 404.

/** The route the pages are served on, which the OpenAPI spec leaves out. */
export const WEB_PATH = "/*";

/** Vite's output folder for everything but index.html. */
const ASSETS_PREFIX = "/assets/";

/** Cache-Control for /assets/*: their names change whenever they do. */
export const ASSET_CACHE = "public, max-age=31536000, immutable";

/** Cache-Control for every other page and file: checked on every load. */
export const PAGE_CACHE = "no-cache";

/** What a page request gets when there's no build. */
export const NOT_BUILT_MESSAGE =
  "The web app isn't built. Run `pnpm build`, then restart the server.\n";

/** What a page request gets in development. */
export const DEVELOPMENT_MESSAGE =
  "In development, Vite serves the web app: open the address `pnpm dev` printed (normally http://localhost:5173).\n";

/** What the server does for pages. */
export type WebApp =
  /** Serves the build in `dir`. */
  | { readonly kind: "build"; readonly dir: string }
  /** Production without a build in `dir`: pages say how to make one. */
  | { readonly kind: "missing"; readonly dir: string }
  /** `pnpm dev`: Vite serves the app, and pages point there. */
  | { readonly kind: "development" };

/**
 * The pages for this run: `dir`'s build, unless it has no index.html, and
 * never in development.
 */
export function findWebApp(env: RuntimeEnv, dir: string): WebApp {
  if (env === "development") return { kind: "development" };
  return existsSync(path.join(dir, "index.html"))
    ? { kind: "build", dir }
    : { kind: "missing", dir };
}

/** The routes for pages, mounted after every API route. */
export function webRoutes(web: WebApp): Hono<AppEnv> {
  const routes = new Hono<AppEnv>();
  const apiStaysApi: MiddlewareHandler<AppEnv> = async (c, next) => {
    if (isApiPath(c.req.path)) return c.notFound();
    await next();
  };
  switch (web.kind) {
    case "build":
      routes.get(WEB_PATH, apiStaysApi, ...fromBuild(web.dir));
      break;
    case "missing":
      routes.get(WEB_PATH, apiStaysApi, (c) =>
        c.text(NOT_BUILT_MESSAGE, 503, { "Cache-Control": "no-store" }),
      );
      break;
    case "development":
      routes.get(WEB_PATH, apiStaysApi, (c) =>
        c.text(DEVELOPMENT_MESSAGE, 404, { "Cache-Control": "no-store" }),
      );
      break;
  }
  return routes;
}

/**
 * Serves the build: a file if it's there, then a miss under /assets/ as 404,
 * then index.html. serveStatic refuses `..` and `%` in paths (they fall
 * through to index.html), and reads each file when it's asked for, so a
 * rebuild shows without a restart.
 */
function fromBuild(dir: string): MiddlewareHandler<AppEnv>[] {
  const root = path.resolve(dir);
  const cacheControl: MiddlewareHandler<AppEnv> = async (c, next) => {
    await next();
    if (!c.res.ok) return;
    c.header(
      "Cache-Control",
      c.req.path.startsWith(ASSETS_PREFIX) ? ASSET_CACHE : PAGE_CACHE,
    );
  };
  const assetMissing: MiddlewareHandler<AppEnv> = async (c, next) => {
    if (c.req.path.startsWith(ASSETS_PREFIX)) return c.notFound();
    await next();
  };
  return [
    cacheControl,
    serveStatic({ root }),
    assetMissing,
    serveStatic({ root, path: "index.html" }),
  ];
}
