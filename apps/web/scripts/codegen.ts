// SPDX-FileCopyrightText: 2026 Open Print Stack contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { fileURLToPath } from "node:url";

import { Generator, getConfig } from "@tanstack/router-generator";
import openapiTS, { astToString } from "openapi-typescript";
import ts from "typescript";

import { ROUTER_CONFIG } from "../router.config.ts";

// The web app's generated files. Both are committed, and a test fails while
// either differs from what this module generates:
//
//   src/api/schema.gen.ts  the API's types, from apps/server/openapi.json
//                          (openapi-typescript)
//   src/routeTree.gen.ts   the route tree, from the files in src/routes
//                          (TanStack Router's generator, which the Vite
//                          plugin also runs on every dev or build run)
//
// Regenerate both with `pnpm --filter @openprintstack/web generate`.

/** apps/web, which the router's paths are relative to. */
export const WEB_ROOT = fileURLToPath(new URL("..", import.meta.url));

const OPENAPI_URL = new URL("../../server/openapi.json", import.meta.url);

export const API_TYPES_FILE = fileURLToPath(
  new URL("../src/api/schema.gen.ts", import.meta.url),
);

const API_TYPES_HEADER = `/**
 * The API's types, generated from apps/server/openapi.json by
 * openapi-typescript. Don't edit this file: run
 * \`pnpm --filter @openprintstack/web generate\`.
 */

`;

/** The contents of src/api/schema.gen.ts for the committed spec. */
export async function renderApiTypes(): Promise<string> {
  const ast = await openapiTS(OPENAPI_URL, {
    silent: true,
    // openapi-typescript writes the recursive JsonValue schema as a union
    // that refers to itself through `components`, which TypeScript refuses
    // (TS2502, on 5.9 as on 6.0). protocol's JsonValue type is the same
    // thing as a named type, which TypeScript accepts.
    inject: 'import type { JsonValue } from "@openprintstack/protocol";',
    transform: (_schema, { path }) =>
      path === "#/components/schemas/JsonValue"
        ? ts.factory.createTypeReferenceNode("JsonValue")
        : undefined,
  });
  return API_TYPES_HEADER + astToString(ast);
}

/**
 * Writes `root`/src/routeTree.gen.ts from `root`/src/routes, as the Vite
 * plugin does. (The generator only writes files; it has no way to return the
 * tree instead.)
 */
export async function generateRouteTree(root: string): Promise<void> {
  const config = getConfig({ ...ROUTER_CONFIG, disableLogging: true }, root);
  await new Generator({ config, root }).run();
}
