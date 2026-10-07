// SPDX-FileCopyrightText: 2026 Open Print Stack contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { defineConfig } from "vitest/config";

// `pnpm test:smoke`: build.smoke.ts, which runs the scripts `pnpm build`
// made. Vitest's usual patterns (*.test.ts) don't match it, so `pnpm test`
// leaves it out.

export default defineConfig({
  test: {
    name: "web-smoke",
    include: ["*.smoke.ts"],
    environment: "jsdom",
    environmentOptions: { jsdom: { url: "http://localhost:7337/" } },
    setupFiles: ["./src/test/setup.ts"],
  },
});
