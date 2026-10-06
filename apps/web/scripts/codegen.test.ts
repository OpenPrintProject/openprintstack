// SPDX-FileCopyrightText: 2026 Open Print Stack contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

// @vitest-environment node

import { cp, mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it, onTestFinished } from "vitest";

import {
  API_TYPES_FILE,
  generateRouteTree,
  renderApiTypes,
  WEB_ROOT,
} from "./codegen.ts";

const REGENERATE =
  "run `pnpm --filter @openprintstack/web generate` and commit the result.";

/** Every file under `dir`, relative to it, with its contents. */
async function contents(dir: string): Promise<Record<string, string>> {
  const files: Record<string, string> = {};
  for (const name of await readdir(dir, {
    recursive: true,
    withFileTypes: true,
  })) {
    if (!name.isFile()) continue;
    const path = join(name.parentPath, name.name);
    files[path.slice(dir.length + 1)] = await readFile(path, "utf8");
  }
  return files;
}

describe("src/api/schema.gen.ts", () => {
  it("matches apps/server/openapi.json (no drift)", async () => {
    expect(
      await readFile(API_TYPES_FILE, "utf8"),
      `src/api/schema.gen.ts is out of date: ${REGENERATE}`,
    ).toBe(await renderApiTypes());
  });
});

describe("src/routeTree.gen.ts", () => {
  it("matches the files in src/routes (no drift), which need no changes", async () => {
    // The generator only writes files, so it runs on a copy of src/routes.
    const root = await mkdtemp(join(tmpdir(), "ops-web-routes-"));
    onTestFinished(async () => {
      await rm(root, { recursive: true, force: true });
    });
    const routes = join(WEB_ROOT, "src/routes");
    await cp(routes, join(root, "src/routes"), { recursive: true });

    await generateRouteTree(root);

    expect(
      await readFile(join(WEB_ROOT, "src/routeTree.gen.ts"), "utf8"),
      `src/routeTree.gen.ts is out of date: ${REGENERATE}`,
    ).toBe(await readFile(join(root, "src/routeTree.gen.ts"), "utf8"));
    expect(
      await contents(join(root, "src/routes")),
      "The router's generator would change files in src/routes.",
    ).toEqual(await contents(routes));
  });
});
