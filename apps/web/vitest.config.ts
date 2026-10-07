// SPDX-FileCopyrightText: 2026 Open Print Stack contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import react from "@vitejs/plugin-react";
import { defineProject } from "vitest/config";

export default defineProject({
  plugins: [react()],
  resolve: { tsconfigPaths: true },
  test: {
    name: "web",
    // A browser-like page for src/; the files outside it (config, code
    // generation) set `@vitest-environment node` themselves.
    environment: "jsdom",
    environmentOptions: { jsdom: { url: "http://localhost:5173/" } },
    setupFiles: ["./src/test/setup.ts"],
    // Runs the expectTypeOf tests in *.test-d.ts through tsc, so `pnpm test`
    // reports them alongside the runtime tests.
    typecheck: { enabled: true, tsconfig: "./tsconfig.json" },
  },
});
