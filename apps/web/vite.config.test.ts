// SPDX-FileCopyrightText: 2026 Open Print Stack contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

// @vitest-environment node

import { createHash } from "node:crypto";
import {
  createServer as createHttpServer,
  type IncomingHttpHeaders,
  request,
  type Server,
} from "node:http";
import type { AddressInfo } from "node:net";

import {
  type ConfigEnv,
  createServer as createViteServer,
  type UserConfig,
} from "vite";
import { describe, expect, it, onTestFinished } from "vitest";

import viteConfig, {
  devProxy,
  LICENSE_FILE,
  serverUrl,
} from "./vite.config.ts";

/** The names of Vite plugins, in order (plugin options nest in arrays). */
function pluginNames(option: unknown): string[] {
  if (Array.isArray(option)) return option.flatMap(pluginNames);
  if (typeof option === "object" && option !== null && "name" in option) {
    return [String(option.name)];
  }
  return [];
}

function configFor(command: ConfigEnv["command"]): UserConfig {
  return viteConfig({
    command,
    mode: command === "serve" ? "development" : "production",
    isSsrBuild: false,
    isPreview: false,
  });
}

describe("serverUrl", () => {
  it.each([
    [{}, "http://127.0.0.1:7337"],
    [{ OPS_PORT: "8000" }, "http://127.0.0.1:8000"],
    [{ OPS_HOST: "printers.local" }, "http://printers.local:7337"],
    [{ OPS_HOST: "192.168.1.20", OPS_PORT: "80" }, "http://192.168.1.20:80"],
    [{ OPS_HOST: "::1" }, "http://[::1]:7337"],
    [{ OPS_HOST: "0.0.0.0" }, "http://127.0.0.1:7337"],
    [{ OPS_HOST: "::" }, "http://127.0.0.1:7337"],
    [{ OPS_HOST: "[::]" }, "http://127.0.0.1:7337"],
  ])("is where the server listens for %j", (env, url) => {
    expect(serverUrl(env)).toBe(url);
  });

  it.each(["0", "65536", "abc", "", " 7337"])("refuses OPS_PORT=%j", (port) => {
    expect(() => serverUrl({ OPS_PORT: port })).toThrow(
      `OPS_PORT is ${JSON.stringify(port)}, so the dev proxy can't find the server. Set it to a fixed port from 1 to 65535 (0, any free port, can't be proxied).`,
    );
  });
});

describe("the Vite config", () => {
  it("proxies /api, the WebSocket included, without changing the origin, when serving", () => {
    expect(configFor("serve").server?.proxy).toEqual({
      "/api": { target: "http://127.0.0.1:7337", ws: true },
    });
  });

  it("has no proxy for a build, so OPS_PORT doesn't matter", () => {
    expect(configFor("build").server).toBeUndefined();
  });

  it("keeps the source's module order in the build, so zod-config.ts runs first", () => {
    expect(configFor("build").build?.rolldownOptions?.output).toEqual({
      strictExecutionOrder: true,
    });
  });

  it("writes the bundled packages' licences to licenses.txt, which the server serves", () => {
    expect(configFor("build").build?.license).toEqual({
      fileName: "licenses.txt",
    });
    expect(LICENSE_FILE).toBe("licenses.txt");
  });

  it("runs the router's plugin before React's, and Tailwind's last", () => {
    const names = pluginNames(configFor("build").plugins);
    const first = (prefix: string) =>
      names.findIndex((name) => name.startsWith(prefix));

    expect(first("tanstack:router-generator")).toBeGreaterThanOrEqual(0);
    expect(first("tanstack:router-generator")).toBeLessThan(
      first("vite:react"),
    );
    expect(first("vite:react")).toBeLessThan(first("@tailwindcss/vite"));
  });
});

type Seen = { url: string; headers: IncomingHttpHeaders };

/**
 * A stand-in for the server: answers HTTP with JSON, and accepts WebSocket
 * upgrades, recording what reaches it.
 */
async function startBackend(): Promise<{ port: number; seen: Seen[] }> {
  const seen: Seen[] = [];
  const server = createHttpServer((req, res) => {
    seen.push({ url: req.url ?? "", headers: req.headers });
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true }));
  });
  server.on("upgrade", (req, socket) => {
    seen.push({ url: req.url ?? "", headers: req.headers });
    const accept = createHash("sha1")
      .update(
        `${req.headers["sec-websocket-key"]}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`,
      )
      .digest("base64");
    socket.end(
      "HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n" +
        `Sec-WebSocket-Accept: ${accept}\r\n\r\n`,
    );
  });
  const port = await listen(server);
  onTestFinished(async () => {
    await new Promise((resolve) => server.close(resolve));
  });
  return { port, seen };
}

function listen(server: Server): Promise<number> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      resolve((server.address() as AddressInfo).port);
    });
  });
}

/** Vite's dev server with just our proxy (no plugins, so nothing is generated). */
async function startVite(backendPort: number): Promise<number> {
  const vite = await createViteServer({
    configFile: false,
    root: import.meta.dirname,
    logLevel: "silent",
    server: {
      host: "127.0.0.1",
      port: 0,
      proxy: devProxy({ OPS_PORT: String(backendPort) }),
    },
  });
  await vite.listen();
  onTestFinished(async () => {
    await vite.close();
  });
  return (vite.httpServer?.address() as AddressInfo).port;
}

/** A WebSocket upgrade request, as a browser on the page would send it. */
function upgrade(port: number, path: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const req = request({
      host: "127.0.0.1",
      port,
      path,
      headers: {
        Connection: "Upgrade",
        Upgrade: "websocket",
        "Sec-WebSocket-Version": "13",
        "Sec-WebSocket-Key": "dGhlIHNhbXBsZSBub25jZQ==",
        Origin: `http://127.0.0.1:${port}`,
        Cookie: "ops_session=abc",
      },
    });
    req.on("upgrade", (res, socket) => {
      socket.destroy();
      resolve(res.statusCode ?? 0);
    });
    req.on("response", (res) => {
      res.resume();
      resolve(res.statusCode ?? 0);
    });
    req.on("error", reject);
    req.setTimeout(5000, () => {
      req.destroy(new Error("The upgrade got no answer within 5 s."));
    });
    req.end();
  });
}

describe("the dev proxy (a real Vite server)", () => {
  it("passes /api requests on with the browser's Host and Origin", async () => {
    const backend = await startBackend();
    const port = await startVite(backend.port);

    const answer = await fetch(`http://127.0.0.1:${port}/api/auth/me`, {
      headers: { Origin: `http://127.0.0.1:${port}` },
    });

    expect(answer.status).toBe(200);
    expect(await answer.json()).toEqual({ ok: true });
    expect(backend.seen).toEqual([
      {
        url: "/api/auth/me",
        headers: expect.objectContaining({
          host: `127.0.0.1:${port}`,
          origin: `http://127.0.0.1:${port}`,
        }) as unknown,
      },
    ]);
  });

  it("passes the WebSocket upgrade at /api/ws on with the browser's Host, Origin and cookie", async () => {
    const backend = await startBackend();
    const port = await startVite(backend.port);

    const status = await upgrade(port, "/api/ws");

    expect(status).toBe(101);
    expect(backend.seen).toEqual([
      {
        url: "/api/ws",
        headers: expect.objectContaining({
          host: `127.0.0.1:${port}`,
          origin: `http://127.0.0.1:${port}`,
          cookie: "ops_session=abc",
          upgrade: "websocket",
        }) as unknown,
      },
    ]);
  });
});
