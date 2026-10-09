// SPDX-FileCopyrightText: 2026 Open Print Stack contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { defineProject } from "vitest/config";

export default defineProject({
  test: {
    name: "driver-elegoo-cc2",
    // Runs the expectTypeOf tests in *.test-d.ts through tsc, so `pnpm test`
    // reports them alongside the runtime tests.
    typecheck: { enabled: true, tsconfig: "./tsconfig.json" },
  },
});
