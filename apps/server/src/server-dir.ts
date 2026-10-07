// SPDX-FileCopyrightText: 2026 Open Print Stack contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import path from "node:path";

// Where the server's own files are, found from this module. It runs from src/
// (pnpm dev and the tests) or, bundled by tsdown, from dist/ (pnpm start).
// Both are directly inside apps/server, so its parent is the server's folder
// either way. The bundle keeps every chunk in dist/ itself for this reason.

/** apps/server: the folder holding the server's package.json. */
export const SERVER_DIR = path.join(import.meta.dirname, "..");

/** The web app's production build, which `pnpm build` writes. */
export const WEB_BUILD_DIR = path.join(SERVER_DIR, "..", "web", "dist");
