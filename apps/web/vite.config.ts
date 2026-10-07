// SPDX-FileCopyrightText: 2026 Open Print Stack contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { isIPv6 } from "node:net";

import tailwindcss from "@tailwindcss/vite";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, type ProxyOptions } from "vite";

import { ROUTER_CONFIG } from "./router.config.ts";

// The web app. `pnpm dev` runs Vite on :5173 next to the server, and Vite
// proxies /api (the socket at /api/ws included) to the server, so the browser
// sees a single origin and the session cookie just works.
//
// The proxy keeps the browser's Host (localhost:5173): `changeOrigin` stays
// false and the socket's Origin isn't rewritten, so the server's Host and
// Origin checks see the same origin the page has.

/** Where the server listens, from the same variables it reads. */
export function serverUrl(env: Record<string, string | undefined>): string {
  const port = env.OPS_PORT ?? "7337";
  if (!/^[0-9]+$/.test(port) || Number(port) < 1 || Number(port) > 65_535) {
    throw new Error(
      `OPS_PORT is ${JSON.stringify(port)}, so the dev proxy can't find the server. Set it to a fixed port from 1 to 65535 (0, any free port, can't be proxied).`,
    );
  }
  let host = env.OPS_HOST ?? "127.0.0.1";
  // Listening on every interface includes loopback.
  if (["0.0.0.0", "::", "[::]"].includes(host)) host = "127.0.0.1";
  if (isIPv6(host)) host = `[${host}]`;
  return `http://${host}:${port}`;
}

/** The dev server's proxy: /api and its WebSocket go to the server. */
export function devProxy(
  env: Record<string, string | undefined>,
): Record<string, ProxyOptions> {
  return { "/api": { target: serverUrl(env), ws: true } };
}

export default defineConfig(({ command }) => ({
  // The router plugin must come before React's.
  plugins: [tanstackRouter(ROUTER_CONFIG), react(), tailwindcss()],
  resolve: { tsconfigPaths: true },
  // Only `vite` (serve) proxies, so a build never depends on OPS_PORT.
  ...(command === "serve" && { server: { proxy: devProxy(process.env) } }),
}));
