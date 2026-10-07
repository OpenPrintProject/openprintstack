// SPDX-FileCopyrightText: 2026 Open Print Stack contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

// `pnpm test:smoke`, after `pnpm build`: the built app's scripts, run in
// jsdom as index.html loads them. The page's Content-Security-Policy forbids
// `new Function`, which the browser reports even when it's caught; the
// source can't show whether the bundle keeps zod-config.ts first, so this
// runs the bundle itself.

import { readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { describe, expect, it, vi } from "vitest";

const DIST = path.join(import.meta.dirname, "dist");

describe("the web app's build", () => {
  it("runs without ever calling new Function, and shows the setup page", async () => {
    const html = await readFile(path.join(DIST, "index.html"), "utf8");
    const entry = /<script type="module"[^>]* src="\/(assets\/[^"]+\.js)"/.exec(
      html,
    )?.[1];
    expect(entry).toBeDefined();
    let calls = 0;
    vi.stubGlobal(
      "Function",
      new Proxy(Function, {
        construct(target, args: string[]) {
          calls += 1;
          return Reflect.construct(target, args);
        },
        apply(target, self, args: string[]) {
          calls += 1;
          return Reflect.apply(target, self, args) as unknown;
        },
      }),
    );
    // A server with no admin yet, as on a first run.
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve(
          Response.json(
            {
              error: {
                code: "setup_required",
                message: "Create the admin account first.",
              },
            },
            { status: 401 },
          ),
        ),
      ),
    );
    document.body.innerHTML = '<div id="root"></div>';

    await import(pathToFileURL(path.join(DIST, entry ?? "")).href);
    await vi.waitFor(
      () => {
        expect(document.body.textContent).toContain("Create the admin account");
      },
      { timeout: 5000 },
    );

    expect(
      (globalThis as { __zod_globalConfig?: { jitless?: boolean } })
        .__zod_globalConfig?.jitless,
    ).toBe(true);
    expect(calls).toBe(0);
  });
});
