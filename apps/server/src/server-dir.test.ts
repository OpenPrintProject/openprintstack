// SPDX-FileCopyrightText: 2026 Open Print Stack contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { readFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { SERVER_DIR, WEB_BUILD_DIR } from "./server-dir.ts";

async function packageName(dir: string): Promise<unknown> {
  const text = await readFile(path.join(dir, "package.json"), "utf8");
  return (JSON.parse(text) as { name?: unknown }).name;
}

// The bundle's side, run from dist/, is the smoke test's
// (production.smoke.ts).
describe("server-dir.ts", () => {
  it("finds the server's folder from src/", async () => {
    expect(SERVER_DIR).toBe(path.resolve(import.meta.dirname, ".."));
    expect(await packageName(SERVER_DIR)).toBe("@openprintstack/server");
  });

  it("finds the web app's build in its sibling, apps/web/dist", async () => {
    expect(WEB_BUILD_DIR).toBe(path.join(SERVER_DIR, "..", "web", "dist"));
    expect(await packageName(path.dirname(WEB_BUILD_DIR))).toBe(
      "@openprintstack/web",
    );
  });
});
