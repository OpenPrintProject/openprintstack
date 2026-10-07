// SPDX-FileCopyrightText: 2026 Open Print Stack contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { tempDir } from "../test-utils.ts";
import { apiError, testApp } from "./test-app.ts";
import {
  BUILD_FILES,
  fakeBuild,
  INDEX_HTML,
  PAGE_CSP,
  SECRET,
} from "./test-web.ts";
import {
  ASSET_CACHE,
  DEVELOPMENT_MESSAGE,
  findWebApp,
  NOT_BUILT_MESSAGE,
  PAGE_CACHE,
} from "./web.ts";

const API_CSP = "default-src 'none'; frame-ancestors 'none'";

async function servingBuild() {
  const dir = await fakeBuild();
  const t = await testApp({ web: { kind: "build", dir } });
  return { t, dir };
}

/** The headers every page gets, whatever it is. */
function expectPageHeaders(answer: Response) {
  const headers = Object.fromEntries(answer.headers);
  expect(headers).toMatchObject({
    "content-security-policy": PAGE_CSP,
    "x-frame-options": "DENY",
    "x-content-type-options": "nosniff",
    "referrer-policy": "same-origin",
    "cross-origin-opener-policy": "same-origin",
    "cross-origin-resource-policy": "same-origin",
  });
  expect(headers["strict-transport-security"]).toBeUndefined();
}

describe("pages from the build", () => {
  it("serves index.html at /, checked again on every load", async () => {
    const { t } = await servingBuild();

    const answer = await t.call("GET", "/");

    expect(answer.status).toBe(200);
    expect(answer.headers.get("content-type")).toBe("text/html; charset=utf-8");
    expect(answer.headers.get("cache-control")).toBe(PAGE_CACHE);
    expectPageHeaders(answer);
    expect(await answer.text()).toBe(INDEX_HTML);
  });

  it.each([
    "/events",
    "/events?printer=p1&types=printer.alert+command.result&telemetry=true",
    "/events/",
    "/printers/new",
    "/printers/0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b",
    "/printers/0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b/edit",
    "/login",
    "/setup",
    "/favicon.ico",
    "/app.js",
    "/assets",
    "/apis",
    "/api-docs/x",
  ])("answers %s with index.html, for the app's router", async (url) => {
    const { t } = await servingBuild();

    const answer = await t.call("GET", url);

    expect(answer.status).toBe(200);
    expect(answer.headers.get("content-type")).toBe("text/html; charset=utf-8");
    expect(answer.headers.get("cache-control")).toBe(PAGE_CACHE);
    expectPageHeaders(answer);
    expect(await answer.text()).toBe(INDEX_HTML);
  });

  it.each(Object.entries(BUILD_FILES))(
    "serves the build's %s with its type",
    async (url, { body, type }) => {
      const { t } = await servingBuild();

      const answer = await t.call("GET", url);

      expect(answer.status).toBe(200);
      expect(answer.headers.get("content-type")).toBe(type);
      expect(answer.headers.get("cache-control")).toBe(
        url.startsWith("/assets/") ? ASSET_CACHE : PAGE_CACHE,
      );
      expectPageHeaders(answer);
      expect(await answer.text()).toBe(body);
    },
  );

  it("caches /assets/* for a year and checks everything else on every load", () => {
    expect(ASSET_CACHE).toBe("public, max-age=31536000, immutable");
    expect(PAGE_CACHE).toBe("no-cache");
  });

  it("answers HEAD like GET, without a body", async () => {
    const { t } = await servingBuild();

    for (const [url, length, cache] of [
      ["/", INDEX_HTML.length, PAGE_CACHE],
      ["/events?types=printer.alert", INDEX_HTML.length, PAGE_CACHE],
      [
        "/assets/index-Ab12Cd34.js",
        BUILD_FILES["/assets/index-Ab12Cd34.js"].body.length,
        ASSET_CACHE,
      ],
    ] as const) {
      const answer = await t.call("HEAD", url);

      expect(answer.status, url).toBe(200);
      expect(answer.headers.get("content-length"), url).toBe(String(length));
      expect(answer.headers.get("cache-control"), url).toBe(cache);
      expect(await answer.text(), url).toBe("");
    }
  });

  it.each([
    "/assets/index-Old00000.js",
    "/assets/",
    "/assets/fonts/geist.woff2",
  ])(
    "answers %s, missing from /assets/, with the JSON 404, not index.html",
    async (url) => {
      const { t } = await servingBuild();

      const answer = await t.call("GET", url);

      expect(answer.status).toBe(404);
      expect(await apiError(answer)).toEqual({
        code: "not_found",
        message: `There's nothing at GET ${url}.`,
      });
      expect(answer.headers.get("cache-control")).toBeNull();
      expectPageHeaders(answer);
    },
  );

  it.each(["/api", "/api/", "/api/nothing", "/api/printers/p1/nothing"])(
    "leaves %s to the API: its JSON 404, with the API's headers",
    async (url) => {
      const { t } = await servingBuild();

      const answer = await t.call("GET", url);

      expect(answer.status).toBe(404);
      expect((await apiError(answer)).code).toBe("not_found");
      expect(answer.headers.get("content-security-policy")).toBe(API_CSP);
      expect(answer.headers.get("cache-control")).toBe("no-store");
    },
  );

  it("still answers the API's own routes", async () => {
    const { t } = await servingBuild();

    const answer = await t.call("GET", "/api/auth/me");

    expect(answer.status).toBe(401);
    expect((await apiError(answer)).code).toBe("setup_required");
  });

  it.each([
    ["POST", "/events"],
    ["PUT", "/"],
    ["PATCH", "/login"],
    ["DELETE", "/assets/index-Ab12Cd34.js"],
  ] as const)(
    "answers %s %s with the JSON 404: only GET and HEAD are pages",
    async (method, url) => {
      const { t } = await servingBuild();

      const answer = await t.call(method, url);

      expect(answer.status).toBe(404);
      expect(await apiError(answer)).toEqual({
        code: "not_found",
        message: `There's nothing at ${method} ${url}.`,
      });
    },
  );

  it("checks the Host, as it does for the API", async () => {
    const { t } = await servingBuild();

    const answer = await t.call("GET", "/", { host: "evil.example" });

    expect(answer.status).toBe(403);
    expect((await apiError(answer)).code).toBe("host_not_allowed");
  });

  it("shows a rebuild without a restart", async () => {
    const { t, dir } = await servingBuild();
    await t.call("GET", "/");

    await writeFile(path.join(dir, "index.html"), "<!doctype html>rebuilt\n");

    expect(await (await t.call("GET", "/events")).text()).toBe(
      "<!doctype html>rebuilt\n",
    );
  });

  it.each([
    "/../secret.txt",
    "/assets/../../secret.txt",
    "/%2e%2e/secret.txt",
    "/..%2fsecret.txt",
    "/assets/..%2f..%2fsecret.txt",
    "/assets/%2e%2e/%2e%2e/secret.txt",
  ])("never serves a file outside the build, for %s", async (url) => {
    const { t } = await servingBuild();

    const answer = await t.call("GET", url);

    expect(await answer.text()).not.toContain(SECRET.trim());
  });
});

describe("pages without a build", () => {
  it.each([
    ["GET", "/"],
    ["GET", "/events?types=printer.alert"],
    ["GET", "/assets/index-Ab12Cd34.js"],
    ["HEAD", "/"],
  ] as const)(
    "answers %s %s with 503 and how to build",
    async (method, url) => {
      const t = await testApp({ web: { kind: "missing", dir: "/no/build" } });

      const answer = await t.call(method, url);

      expect(answer.status).toBe(503);
      expect(answer.headers.get("content-type")).toBe(
        "text/plain; charset=UTF-8",
      );
      expect(answer.headers.get("cache-control")).toBe("no-store");
      expectPageHeaders(answer);
      expect(await answer.text()).toBe(
        method === "HEAD" ? "" : NOT_BUILT_MESSAGE,
      );
    },
  );

  it("says to run pnpm build, then restart", () => {
    expect(NOT_BUILT_MESSAGE).toBe(
      "The web app isn't built. Run `pnpm build`, then restart the server.\n",
    );
  });

  it("still serves the API", async () => {
    const t = await testApp({ web: { kind: "missing", dir: "/no/build" } });

    expect((await t.call("GET", "/api/auth/me")).status).toBe(401);
    const unknown = await t.call("GET", "/api/nothing");
    expect(unknown.status).toBe(404);
    expect((await apiError(unknown)).code).toBe("not_found");
  });
});

describe("pages in development", () => {
  it.each(["/", "/events", "/assets/index-Ab12Cd34.js"])(
    "answers %s with 404 and a pointer to Vite",
    async (url) => {
      const t = await testApp({ web: { kind: "development" } });

      const answer = await t.call("GET", url);

      expect(answer.status).toBe(404);
      expect(answer.headers.get("content-type")).toBe(
        "text/plain; charset=UTF-8",
      );
      expect(answer.headers.get("cache-control")).toBe("no-store");
      expectPageHeaders(answer);
      expect(await answer.text()).toBe(DEVELOPMENT_MESSAGE);
    },
  );

  it("names Vite's usual address", () => {
    expect(DEVELOPMENT_MESSAGE).toContain("http://localhost:5173");
  });

  it("still serves the API", async () => {
    const t = await testApp({ web: { kind: "development" } });

    expect((await t.call("GET", "/api/auth/me")).status).toBe(401);
    expect((await t.call("GET", "/api/nothing")).status).toBe(404);
  });
});

describe("findWebApp", () => {
  it.each(["production", "test"] as const)(
    "serves a build with an index.html in %s",
    async (env) => {
      const dir = await fakeBuild();

      expect(findWebApp(env, dir)).toEqual({ kind: "build", dir });
    },
  );

  it("counts a folder without index.html as no build", async () => {
    const dir = path.join(await tempDir(), "dist");
    await mkdir(path.join(dir, "assets"), { recursive: true });

    expect(findWebApp("production", dir)).toEqual({ kind: "missing", dir });
  });

  it("counts a missing folder as no build", async () => {
    const dir = path.join(await tempDir(), "nothing");

    expect(findWebApp("production", dir)).toEqual({ kind: "missing", dir });
  });

  it("never serves a build in development", async () => {
    const dir = await fakeBuild();

    expect(findWebApp("development", dir)).toEqual({ kind: "development" });
  });
});
