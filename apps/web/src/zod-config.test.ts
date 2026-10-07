// SPDX-FileCopyrightText: 2026 Open Print Stack contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it, vi } from "vitest";

import mainSource from "./main.tsx?raw";

// Nothing at the top imports Zod or protocol: Zod would build schemas (and
// probe) before the test could watch.

describe("zod-config.ts", () => {
  it("keeps Zod from calling new Function, when imported before any schema is built", async () => {
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

    await import("./zod-config.ts");
    const { OpsEvent, WsServerMessage } =
      await import("@openprintstack/protocol");
    OpsEvent.safeParse({ id: "x" });
    WsServerMessage.safeParse({ type: "pong" });
    vi.unstubAllGlobals();

    expect(calls).toBe(0);
  });

  it("is the first thing main.tsx imports", () => {
    const imports = [
      ...mainSource.matchAll(/^import\s.*?["']([^"']+)["'];$/gms),
    ];

    expect(imports[0]?.[1]).toBe("./zod-config.ts");
  });
});
