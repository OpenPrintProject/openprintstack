// SPDX-FileCopyrightText: 2026 Open Print Stack contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { defineConfig } from "tsdown";

// `pnpm build` bundles the server into dist/main.mjs (plus a chunk or two),
// with a source map that `pnpm start` uses for stack traces. Our workspace
// packages (protocol, driver-sdk and the drivers) are TypeScript source, so
// they're bundled in; npm packages stay in node_modules, as under `pnpm dev`.
// The bundle finds them from the server's own node_modules, so the server
// lists the drivers' npm dependencies too (mqtt, for the CC2).
// The bundle finds the server's own files from dist/ (src/server-dir.ts), so
// every chunk must stay in dist/ itself, which is tsdown's default.

export default defineConfig({
  entry: { main: "src/main.ts" },
  platform: "node",
  format: "esm",
  outDir: "dist",
  sourcemap: true,
  dts: false,
  clean: true,
  deps: {
    alwaysBundle: [/^@openprintstack\//],
    // A devDependency that logger.ts loads only in development.
    neverBundle: ["pino-pretty"],
    // The build fails if anything from node_modules is bundled.
    onlyBundle: [],
  },
});
