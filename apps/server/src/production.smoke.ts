// SPDX-FileCopyrightText: 2026 Open Print Stack contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

// `pnpm test:smoke`, after `pnpm build`: the real build, started the way
// `pnpm start` starts it, checked end to end. `pnpm test` leaves it out, as
// it needs the build; CI runs it straight after `pnpm build`. Everything
// here is tested in detail in-process; these check the build itself.

import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import http, {
  type IncomingHttpHeaders,
  type IncomingMessage,
} from "node:http";
import net from "node:net";
import path from "node:path";

import { beforeAll, describe, expect, it, onTestFinished } from "vitest";

import serverPackage from "../package.json" with { type: "json" };
import { SESSION_COOKIE } from "./auth/sessions.ts";
import { runNode } from "./test-process.ts";
import { tempDir } from "./test-utils.ts";
import { TestClient } from "./ws/test-client.ts";

// Found here, not from server-dir.ts, which these tests check.
const SERVER_DIR = path.join(import.meta.dirname, "..");
const DIST = path.join(SERVER_DIR, "dist");
const WEB_BUILD_DIR = path.join(SERVER_DIR, "..", "web", "dist");

/** A throwaway admin password for the run's temporary database. */
const PASSWORD = "smoke test password";

const PAGE_CSP =
  "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self'; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'";

/** `pnpm start`'s command, which must be `node <args> dist/main.mjs`. */
function startArgs(): string[] {
  const [command, ...args] = serverPackage.scripts.start.split(" ");
  expect(command).toBe("node");
  expect(path.resolve(SERVER_DIR, args.at(-1) ?? "")).toBe(
    path.join(DIST, "main.mjs"),
  );
  return args;
}

/** Starts the build with a fresh data dir, as `pnpm start` would. */
async function startBuild(env: Record<string, string> = {}) {
  const main = runNode(
    startArgs(),
    { OPS_DATA_DIR: await tempDir(), OPS_PORT: "0", ...env },
    { cwd: SERVER_DIR, waitMs: 15_000 },
  );
  return main;
}

/** Starts the build and waits until it's listening. */
async function listening() {
  const main = await startBuild();
  const { url } = (await main.waitForLog("Listening on")) as { url: string };
  onTestFinished(async () => {
    if (main.child.exitCode === null) {
      main.child.kill("SIGTERM");
      await main.exited;
    }
  });
  return { main, url };
}

type Answer = { status: number; headers: IncomingHttpHeaders; body: string };

/** Sends a request on a connection of its own, closed after the answer. */
function send(
  url: string,
  options: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
  } = {},
): Promise<Answer> {
  return new Promise((resolve, reject) => {
    const request = http.request(url, {
      method: options.method ?? "GET",
      headers: options.headers ?? {},
      agent: false,
    });
    request.on("error", reject);
    request.on("response", (message: IncomingMessage) => {
      let body = "";
      message.setEncoding("utf8");
      message.on("data", (chunk: string) => {
        body += chunk;
      });
      message.on("end", () => {
        resolve({
          status: message.statusCode ?? 0,
          headers: message.headers,
          body,
        });
      });
    });
    request.end(options.body);
  });
}

describe("the production build", { timeout: 30_000 }, () => {
  beforeAll(() => {
    for (const file of [
      path.join(DIST, "main.mjs"),
      path.join(WEB_BUILD_DIR, "index.html"),
    ]) {
      if (!existsSync(file)) {
        throw new Error(`There's no ${file}. Run pnpm build first.`);
      }
    }
  });

  it("starts from dist/, migrates, finds the web build, and stops cleanly", async () => {
    const { main } = await listening();

    main.child.kill("SIGTERM");

    expect(await main.exited).toBe(0);
    const lines = main.lines();
    expect(main.logged("Applied database migrations")).toMatchObject({
      level: "info",
    });
    expect(
      main.logged(`Serving the web app from ${WEB_BUILD_DIR}`),
    ).toBeDefined();
    expect(lines.filter((line) => line.level !== "info")).toEqual([]);
    expect(main.logged("Stopped")).toBeDefined();
  });

  it("serves the app: a page, a deep link, its files and the licences", async () => {
    const { url } = await listening();

    const home = await send(`${url}/`);
    const deep = await send(`${url}/events?types=printer.alert`);

    expect(home.status).toBe(200);
    expect(home.headers["content-type"]).toBe("text/html; charset=utf-8");
    expect(home.headers["content-security-policy"]).toBe(PAGE_CSP);
    expect(home.headers["cache-control"]).toBe("no-cache");
    expect(home.body).toContain('<div id="root"></div>');
    expect(deep.status).toBe(200);
    expect(deep.body).toBe(home.body);

    const files = [
      ...home.body.matchAll(/(?:src|href)="(\/assets\/[^"]+)"/g),
    ].map((match) => match[1]!);
    expect(files.some((file) => file.endsWith(".js"))).toBe(true);
    expect(files.some((file) => file.endsWith(".css"))).toBe(true);
    for (const file of files) {
      const answer = await send(`${url}${file}`);
      expect(answer.status, file).toBe(200);
      expect(answer.headers["content-type"], file).toBe(
        file.endsWith(".js")
          ? "text/javascript; charset=utf-8"
          : "text/css; charset=utf-8",
      );
      expect(answer.headers["cache-control"], file).toBe(
        "public, max-age=31536000, immutable",
      );
    }

    const licences = await send(`${url}/licenses.txt`);
    expect(licences.headers["content-type"]).toBe("text/plain; charset=utf-8");
    expect(licences.body).toMatch(/^## react - \S+ \(MIT\)$/m);

    const missing = await send(`${url}/assets/index-gone.js`);
    expect(missing.status).toBe(404);
  });

  it("serves the API and the WebSocket, with a printer from the bundled driver", async () => {
    const { url } = await listening();

    const setup = await send(`${url}/api/auth/setup`, {
      method: "POST",
      headers: { origin: url, "content-type": "application/json" },
      body: JSON.stringify({ username: "smoke", password: PASSWORD }),
    });
    expect(setup.status).toBe(201);
    const token =
      new RegExp(`${SESSION_COOKIE}=([^;]*)`).exec(
        setup.headers["set-cookie"]?.join("\n") ?? "",
      )?.[1] ?? "";
    const headers = {
      origin: url,
      cookie: `${SESSION_COOKIE}=${token}`,
      "content-type": "application/json",
    };
    // Every bundled driver loads, including the CC2's, whose MQTT client the
    // build must find in node_modules. One that couldn't would be left out.
    const types = await send(`${url}/api/driver-types`, { headers });
    expect(types.status).toBe(200);
    expect(
      (
        JSON.parse(types.body) as { driverTypes: { type: string }[] }
      ).driverTypes.map((type) => type.type),
    ).toEqual(["simulated", "elegoo-cc2"]);

    const added = await send(`${url}/api/printers`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        name: "Sim",
        driverType: "simulated",
        settings: {},
      }),
    });
    expect(added.status).toBe(201);
    const { id: printerId } = JSON.parse(added.body) as { id: string };

    const client = await TestClient.connect(url, { token });
    client.send({ type: "subscribe", topic: { name: "printer", printerId } });

    expect(await client.next()).toMatchObject({
      type: "hello",
      user: { username: "smoke" },
    });
    expect(
      await client.nextMatching((m) => m.type === "snapshot"),
    ).toMatchObject({ data: { state: { status: "idle" } } });
  });

  it("names the source files in stack traces", async () => {
    const taken = net.createServer();
    taken.listen(0, "127.0.0.1");
    await new Promise((resolve) => taken.once("listening", resolve));
    onTestFinished(() => {
      taken.close();
    });
    const port = (taken.address() as net.AddressInfo).port;

    const main = await startBuild({ OPS_PORT: String(port) });

    expect(await main.exited).toBe(1);
    const fatal = main.lines().find((line) => line.level === "fatal");
    const stack = (fatal?.err as { stack?: string } | undefined)?.stack ?? "";
    expect(stack).toContain(path.join(SERVER_DIR, "src", "server.ts"));
    expect(stack).not.toContain("dist/main.mjs");
  });

  it("bundles our own source and nothing from node_modules", async () => {
    const sources: string[] = [];
    for (const file of await readdir(DIST)) {
      if (!file.endsWith(".mjs.map")) continue;
      const map = JSON.parse(await readFile(path.join(DIST, file), "utf8")) as {
        sources: string[];
      };
      sources.push(
        ...map.sources.map((source) =>
          path.relative(SERVER_DIR, path.resolve(DIST, source)),
        ),
      );
    }

    expect(sources).toContain(path.join("src", "main.ts"));
    for (const pkg of [
      "protocol",
      "driver-sdk",
      "driver-simulated",
      "driver-elegoo-cc2",
    ]) {
      expect(
        sources.some((source) =>
          source.startsWith(path.join("..", "..", "packages", pkg, "src")),
        ),
        pkg,
      ).toBe(true);
    }
    expect(sources.filter((source) => source.includes("node_modules"))).toEqual(
      [],
    );
  });
});
