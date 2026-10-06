// SPDX-FileCopyrightText: 2026 Open Print Stack contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

// Writes apps/server/openapi.json from the server's routes. Run it after
// changing a route or a schema the API uses:
//   pnpm --filter @openprintstack/server openapi:emit
// A test fails while the committed file differs from what this writes.

import { writeFile } from "node:fs/promises";

import {
  OPENAPI_FILE,
  openApiDocument,
  renderOpenApi,
} from "../src/http/openapi.ts";

await writeFile(OPENAPI_FILE, renderOpenApi(openApiDocument()));
console.log(`Wrote ${OPENAPI_FILE}`);
