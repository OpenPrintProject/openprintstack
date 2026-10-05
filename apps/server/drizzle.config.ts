// SPDX-FileCopyrightText: 2026 Open Print Stack contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { defineConfig } from "drizzle-kit";

// Generates the SQL migrations in drizzle/ from src/db/schema.ts. Name each
// one after what it changes:
//   pnpm --filter @openprintstack/server db:generate --name <what_changed>
// CI regenerates them and fails if the committed files are out of date.
export default defineConfig({
  dialect: "sqlite",
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  strict: true,
});
