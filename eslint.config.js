// SPDX-FileCopyrightText: 2026 Open Print Stack contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { builtinModules } from "node:module";

import js from "@eslint/js";
import { defineConfig, globalIgnores } from "eslint/config";
import prettier from "eslint-config-prettier";
import globals from "globals";
import tseslint from "typescript-eslint";

const nodeBuiltins = {
  paths: builtinModules.map((name) => ({
    name,
    message: "This package must not depend on Node built-ins.",
  })),
  patterns: [
    {
      group: ["node:*"],
      message: "This package must not depend on Node built-ins.",
    },
  ],
};

// Globals that exist in Node but not in browsers (process, Buffer, require...).
// Shared ones such as structuredClone, URL and setTimeout stay allowed. Node's
// types can still reach browser-safe packages through Vitest's, so tsc alone
// doesn't catch these. checkGlobalObject also catches `globalThis.process`.
const nodeGlobals = {
  globals: Object.keys(globals.node)
    .filter((name) => !Object.hasOwn(globals.browser, name))
    .map((name) => ({
      name,
      message: "This package must not depend on Node globals.",
    })),
  checkGlobalObject: true,
};

const serverAndStorage = [
  {
    group: ["@openprintstack/server", "@openprintstack/server/*"],
    message: "Only the server may import server code.",
  },
  {
    group: ["hono", "hono/*", "@hono/*"],
    message: "HTTP code belongs in apps/server.",
  },
  {
    group: ["drizzle-orm", "drizzle-orm/*", "better-sqlite3"],
    message: "Database code belongs in apps/server.",
  },
];

export default defineConfig(
  globalIgnores([
    "**/dist/",
    "**/coverage/",
    "**/*.gen.ts",
    "apps/server/drizzle/",
  ]),

  js.configs.recommended,
  tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    files: ["*.js", "*.ts"],
    languageOptions: { globals: globals.node },
  },

  // Boundaries: every feature talks to the driver interface, never to a brand,
  // and shared code stays free of server, database and Node dependencies.
  {
    files: ["packages/protocol/**"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: nodeBuiltins.paths,
          patterns: [
            ...nodeBuiltins.patterns,
            ...serverAndStorage,
            {
              group: ["@openprintstack/*"],
              message: "protocol must not depend on other workspace packages.",
            },
          ],
        },
      ],
      "no-restricted-globals": ["error", nodeGlobals],
    },
  },
  {
    files: ["packages/driver-*/**"],
    rules: {
      "no-restricted-imports": ["error", { patterns: serverAndStorage }],
    },
  },
  {
    files: ["apps/web/**"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: nodeBuiltins.paths,
          patterns: [
            ...nodeBuiltins.patterns,
            ...serverAndStorage,
            {
              group: ["@openprintstack/driver-*", "@openprintstack/driver-*/*"],
              message: "The web app talks to printers through the API only.",
            },
          ],
        },
      ],
      "no-restricted-globals": ["error", nodeGlobals],
    },
  },
  {
    files: ["apps/server/src/**"],
    ignores: ["apps/server/src/drivers/registry.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: [
                "@openprintstack/driver-*",
                "!@openprintstack/driver-sdk",
                "!@openprintstack/driver-sdk/*",
              ],
              message:
                "Load drivers through drivers/registry.ts; everything else talks to the driver interface.",
            },
          ],
        },
      ],
    },
  },

  prettier,
);
