// SPDX-FileCopyrightText: 2026 Open Print Stack contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { join } from "node:path";
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
    transform: (schema, { path }) => {
      if (path === "#/components/schemas/JsonValue") {
        return ts.factory.createTypeReferenceNode("JsonValue");
      }
      // A file's bytes (an upload's body, a snapshot), which the spec gives
      // as a string with a contentMediaType, as OpenAPI 3.1 does. In the
      // browser they're a Blob (a File is one).
      if (isBinary(schema)) return ts.factory.createTypeReferenceNode("Blob");
      return undefined;
    },
  });
  return API_TYPES_HEADER + astToString(ast);
}

/** A string schema for bytes of a non-JSON media type. */
function isBinary(schema: unknown): boolean {
  if (typeof schema !== "object" || schema === null) return false;
  const { type, contentMediaType } = schema as Record<string, unknown>;
  return (
    type === "string" &&
    typeof contentMediaType === "string" &&
    !contentMediaType.includes("json")
  );
}

/**
 * Writes `root`/src/routeTree.gen.ts from `root`/src/routes, as the Vite
 * plugin does. (The generator only writes files; it has no way to return the
 * tree instead.)
 */
export async function generateRouteTree(root: string): Promise<void> {
  const config = getConfig(
    {
      ...ROUTER_CONFIG,
      disableLogging: true,
      // The generator writes the tree to a temporary file and renames it into
      // place, which only works within one drive. By default that file is
      // under the working directory, which on Windows can be on a different
      // drive from `root` (the tests' copy is in the system's temp folder).
      tmpDir: join(root, ".tanstack", "tmp"),
    },
    root,
  );
  await new Generator({ config, root }).run();
}
