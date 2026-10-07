// SPDX-FileCopyrightText: 2026 Open Print Stack contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

// A small web build like Vite's, for the tests of pages. Not used by the
// server itself.

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { tempDir } from "../test-utils.ts";

/** The Content-Security-Policy every page gets. */
export const PAGE_CSP =
  "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self'; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'";

export const INDEX_HTML =
  '<!doctype html>\n<div id="root"></div>\n<script type="module" src="/assets/index-Ab12Cd34.js"></script>\n';

/** Each file in the build, by URL path, with its contents and type. */
export const BUILD_FILES = {
  "/index.html": { body: INDEX_HTML, type: "text/html; charset=utf-8" },
  "/licenses.txt": { body: "# Licenses\n", type: "text/plain; charset=utf-8" },
  "/assets/index-Ab12Cd34.js": {
    body: 'console.log("the app");\n',
    type: "text/javascript; charset=utf-8",
  },
  "/assets/index-Ef56Gh78.css": {
    body: "body { margin: 0; }\n",
    type: "text/css; charset=utf-8",
  },
  "/assets/geist-latin-Ij90Kl12.woff2": {
    body: "wOF2 not really a font\n",
    type: "font/woff2",
  },
} as const;

/** What's beside the build, which must never be served. */
export const SECRET = "Not for the web.\n";

/**
 * Writes the build to `<temp>/dist`, with `<temp>/secret.txt` beside it,
 * and returns the build's folder.
 */
export async function fakeBuild(): Promise<string> {
  const root = await tempDir();
  const dir = path.join(root, "dist");
  for (const [urlPath, { body }] of Object.entries(BUILD_FILES)) {
    const file = path.join(dir, urlPath);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, body);
  }
  await writeFile(path.join(root, "secret.txt"), SECRET);
  return dir;
}
