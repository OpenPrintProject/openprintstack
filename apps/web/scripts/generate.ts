// SPDX-FileCopyrightText: 2026 Open Print Stack contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

// Writes the web app's generated files: run it after changing the server's
// API (and running its `openapi:emit`), or the files in src/routes when Vite
// isn't running:
//   pnpm --filter @openprintstack/web generate

import { writeFile } from "node:fs/promises";

import {
  API_TYPES_FILE,
  generateRouteTree,
  renderApiTypes,
  WEB_ROOT,
} from "./codegen.ts";

await writeFile(API_TYPES_FILE, await renderApiTypes());
console.log(`Wrote ${API_TYPES_FILE}`);
await generateRouteTree(WEB_ROOT);
console.log("Wrote the route tree");
