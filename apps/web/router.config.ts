// SPDX-FileCopyrightText: 2026 Open Print Stack contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { Config } from "@tanstack/router-generator";

/**
 * TanStack Router's file-based routing: src/routes holds one file per route,
 * and src/routeTree.gen.ts is generated from them. The Vite plugin (on every
 * dev or build run) and `pnpm generate` share these settings; paths are
 * relative to apps/web.
 */
export const ROUTER_CONFIG = {
  target: "react",
  autoCodeSplitting: true,
  routesDirectory: "./src/routes",
  generatedRouteTree: "./src/routeTree.gen.ts",
  // Tests next to a route aren't routes.
  routeFileIgnorePattern: String.raw`\.test\.tsx?$`,
  // The repo's style: imports with extensions, double quotes, semicolons.
  addExtensions: true,
  quoteStyle: "double",
  semicolons: true,
} satisfies Partial<Config>;
