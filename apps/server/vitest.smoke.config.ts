// SPDX-FileCopyrightText: 2026 Open Print Stack contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { defineConfig } from "vitest/config";

// `pnpm test:smoke`: production.smoke.ts, which starts the build `pnpm build`
// made. Vitest's usual patterns (*.test.ts) don't match it, so `pnpm test`
// leaves it out.

export default defineConfig({
  test: {
    name: "smoke",
    include: ["src/**/*.smoke.ts"],
  },
});
