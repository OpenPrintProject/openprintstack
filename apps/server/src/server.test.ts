// SPDX-FileCopyrightText: 2026 Open Print Stack contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { once } from "node:events";
import { readdir } from "node:fs/promises";
import http, { type IncomingMessage } from "node:http";
import net from "node:net";
import path from "node:path";

import { describe, expect, it, onTestFinished } from "vitest";

import { SESSION_COOKIE } from "./auth/sessions.ts";
import type { Config } from "./config.ts";
import { openDatabase } from "./db/client.ts";
import { migrateDatabase } from "./db/migrate.ts";
import { createRepos } from "./db/repos/index.ts";
import {
  TEST_DRIVER_TYPE,
  TestDrivers,
  testRegistry,
} from "./drivers/test-driver.ts";
import { testApp } from "./http/test-app.ts";
import {
  ListenError,
  type RunningServer,
  SERVER_VERSION,
  startServer,
} from "./server.ts";
import {
  debugLogger,
  jsonLines,
  settle,
  silentLogger,
  tempDir,
} from "./test-utils.ts";
import { serveTestApp, TestClient, WAIT_MS } from "./ws/test-client.ts";

const PASSWORD = "correct horse battery";

async function testConfig(overrides: Partial<Config> = {}): Promise<Config> {
  return {
    env: "test",
    host: "127.0.0.1",
    port: 0,
    allowedHosts: [],
    dataDir: await tempDir(),
    logLevel: "debug",
    telemetry: { sampleIntervalMs: 5000, retentionDays: 7 },
    ...overrides,
  };
}

/** Stores a test-driver printer before the server starts, as a restart finds it. */
function storePrinter(dataDir: string, name = "Bench"): string {
  const db = openDatabase(path.join(dataDir, "ops.sqlite"));
  try {
    migrateDatabase(db, silentLogger);
    return createRepos(db).printers.create({
      name,
      driverType: TEST_DRIVER_TYPE,
      settings: { nozzleMaxC: 250, failCreate: false },
      now: 1,
    }).id;
  } finally {
    db.$client.close();
  }
}

/** Every stored event's type (and status, for status changes), in row order. */
function storedEvents(dataDir: string): string[] {
  const db = openDatabase(path.join(dataDir, "ops.sqlite"));
  try {
    const rows = db.$client
      .prepare("SELECT type, payload FROM events ORDER BY row_id")
      .all() as { type: string; payload: string }[];
    return rows.map(({ type, payload }) =>
      type === "printer.status_changed"
        ? `${type} → ${(JSON.parse(payload) as { status: string }).status}`
        : type,
    );
  } finally {
    db.$client.close();
  }
}

async function start(config: Config) {
  const { logger, output } = await debugLogger();
  const drivers = new TestDrivers();
  const server = await startServer({
    config,
    logger,
    registry: testRegistry(drivers),
  });
  onTestFinished(async () => {
    await server.stop();
  });
  return { server, drivers, logs: output };
}

/** Creates the admin over HTTP and returns the session token. */
async function setupAdmin(server: RunningServer): Promise<string> {
  const response = await fetch(`${server.url}/api/auth/setup`, {
    method: "POST",
    headers: { origin: server.url, "content-type": "application/json" },
    body: JSON.stringify({ username: "rob", password: PASSWORD }),
  });
  expect(response.status).toBe(201);
  const cookie = response.headers
    .getSetCookie()
    .find((header) => header.startsWith(`${SESSION_COOKIE}=`));
  return /^ops_session=([^;]*)/.exec(cookie ?? "")?.[1] ?? "";
}

/** A port nothing is listening on right now. */
async function freePort(): Promise<number> {
  const probe = net.createServer();
  probe.listen(0, "127.0.0.1");
  await once(probe, "listening");
  const { port } = probe.address() as net.AddressInfo;
  await new Promise((resolve) => probe.close(resolve));
  return port;
}

/** Whether anything accepts a TCP connection on the port. */
function accepts(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.connect(port, "127.0.0.1");
    socket.once("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.once("error", () => {
      resolve(false);
    });
  });
}

describe("startServer", () => {
  it("doesn't listen until every printer has made its first connect attempt", async () => {
    const port = await freePort();
    const config = await testConfig({ port });
    storePrinter(config.dataDir);
    const drivers = new TestDrivers();
    let release: (() => void) | undefined;
    const connecting = new Promise<void>((started) => {
      drivers.handle(
        "connect",
        (_args, driver) =>
          new Promise<void>((resolve) => {
            release = () => {
              driver.emit({
                type: "status",
                status: "idle",
                detail: null,
                error: null,
              });
              resolve();
            };
            started();
          }),
      );
    });

    const starting = startServer({
      config,
      logger: silentLogger,
      registry: testRegistry(drivers),
    });
    onTestFinished(async () => {
      release?.();
      await (await starting).stop();
    });
    await connecting;

    expect(await accepts(port)).toBe(false);
    release?.();
    const server = await starting;
    expect(server.port).toBe(port);
    expect(await accepts(port)).toBe(true);
  });

  it("starts the printers before it listens, and publishes system.started last", async () => {
    const config = await testConfig();
    const printerId = storePrinter(config.dataDir);

    const { server, logs } = await start(config);
    const token = await setupAdmin(server);
    const client = await TestClient.connect(server.url, { token });
    client.send({ type: "subscribe", topic: { name: "fleet" } });
    const snapshot = await client.nextMatching((m) => m.type === "snapshot");
    await server.stop();

    const messages = jsonLines(logs)
      .filter((line) => line.component === "server")
      .map((line) => line.msg);
    expect(messages.slice(0, 2)).toEqual([
      "Started the printers",
      `Listening on ${server.url}`,
    ]);
    // Already connected when the first client could look.
    expect(snapshot).toMatchObject({
      data: [{ printer: { id: printerId }, state: { status: "idle" } }],
    });
    expect(storedEvents(config.dataDir)).toEqual([
      "printer.status_changed → connecting",
      "printer.capabilities_changed",
      "printer.status_changed → idle",
      "system.started",
      "auth.setup_completed",
      "system.stopping",
      "printer.status_changed → offline",
    ]);
  });

  it("listens where it says, and says which port OPS_PORT=0 got", async () => {
    const { server, logs } = await start(await testConfig());

    expect(server.port).toBeGreaterThan(0);
    expect(server.url).toBe(`http://127.0.0.1:${server.port}`);
    expect(
      jsonLines(logs).find((line) => line.msg === `Listening on ${server.url}`),
    ).toMatchObject({
      level: "info",
      url: server.url,
      version: SERVER_VERSION,
    });
    const answer = await fetch(`${server.url}/api/openapi.json`);
    expect(answer.status).toBe(200);
  });

  it("stores system.started with the server's version", async () => {
    const config = await testConfig();
    const { server } = await start(config);
    await server.stop();

    const db = openDatabase(path.join(config.dataDir, "ops.sqlite"));
    onTestFinished(() => {
      db.$client.close();
    });
    const row = db.$client
      .prepare("SELECT payload FROM events WHERE type = 'system.started'")
      .pluck()
      .get() as string;
    expect(JSON.parse(row)).toEqual({ version: "0.0.0" });
    expect(SERVER_VERSION).toBe("0.0.0");
  });

  it("fails with a clear message when the port is taken, leaving nothing running", async () => {
    const taken = net.createServer();
    taken.listen(0, "127.0.0.1");
    await once(taken, "listening");
    onTestFinished(() => {
      taken.close();
    });
    const port = (taken.address() as net.AddressInfo).port;
    const config = await testConfig({ port });
    storePrinter(config.dataDir);
    const drivers = new TestDrivers();

    const starting = startServer({
      config,
      logger: silentLogger,
      registry: testRegistry(drivers),
    });

    await expect(starting).rejects.toThrow(ListenError);
    await expect(starting).rejects.toThrow(
      `Port ${port} on 127.0.0.1 is already in use. Stop whatever is using it, or set OPS_PORT to another port.`,
    );
    expect(drivers.created.map((driver) => driver.disposed)).toEqual([true]);
    expect(storedEvents(config.dataDir)).toEqual([
      "printer.status_changed → connecting",
      "printer.capabilities_changed",
      "printer.status_changed → idle",
      "printer.status_changed → offline",
    ]);
  });
});

describe("stop", () => {
  it("publishes system.stopping, closes sockets with 1001, then stops the drivers", async () => {
    const config = await testConfig();
    storePrinter(config.dataDir);
    const { server } = await start(config);
    const token = await setupAdmin(server);
    const client = await TestClient.connect(server.url, { token });
    client.send({ type: "subscribe", topic: { name: "events" } });
    await client.nextMatching((m) => m.type === "snapshot");

    await server.stop();

    const closed = await client.closing();
    const events = client.messages.flatMap((m) =>
      m.type === "event" ? [m.event.type] : [],
    );
    // The drivers stopped after the socket closed: no offline status on it.
    expect(events).toEqual(["system.stopping"]);
    expect(closed).toEqual({
      code: 1001,
      reason: "The server is shutting down.",
    });
    expect(storedEvents(config.dataDir).slice(-2)).toEqual([
      "system.stopping",
      "printer.status_changed → offline",
    ]);
  });

  it("finishes a request in flight before stopping the drivers", async () => {
    const config = await testConfig();
    const printerId = storePrinter(config.dataDir);
    const { server, drivers } = await start(config);
    const token = await setupAdmin(server);
    let release: (() => void) | undefined;
    drivers.latest(printerId).handle(
      "home",
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    const answer = fetch(`${server.url}/api/printers/${printerId}/commands`, {
      method: "POST",
      headers: {
        origin: server.url,
        "content-type": "application/json",
        cookie: `${SESSION_COOKIE}=${token}`,
      },
      body: JSON.stringify({ kind: "motion.home", axes: [] }),
    });
    await waitUntil(() => drivers.latest(printerId).ops().includes("home"));

    const stopped = server.stop();
    await settle();
    release?.();

    expect((await answer).status).toBe(200);
    await stopped;
    expect(storedEvents(config.dataDir).slice(-4)).toEqual([
      "command.requested",
      "system.stopping",
      "command.result",
      "printer.status_changed → offline",
    ]);
  });

  it("doesn't wait for idle keep-alive connections", async () => {
    const { server } = await start(await testConfig());
    // fetch keeps its connection open for reuse.
    await (await fetch(`${server.url}/api/openapi.json`)).text();

    const started = performance.now();
    await server.stop();

    // Node's keep-alive timeout is 5 s; closing waits for none of it.
    expect(performance.now() - started).toBeLessThan(3000);
  });

  it("returns the same promise when called again", async () => {
    const { server } = await start(await testConfig());

    const first = server.stop();

    expect(server.stop()).toBe(first);
    await first;
  });
});

/** Waits for `check` to be true, for up to WAIT_MS. */
async function waitUntil(check: () => boolean): Promise<void> {
  const deadline = Date.now() + WAIT_MS;
  while (!check()) {
    if (Date.now() > deadline) throw new Error("Timed out waiting.");
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

describe("HTTP over a real socket", () => {
  const MiB = 1024 * 1024;

  async function served() {
    const t = await testApp();
    const { port, url } = await serveTestApp(t);
    const { token } = await t.setupAdmin();
    const printerId = await t.addPrinter(token);
    return { t, port, url, token, printerId };
  }

  function upload(
    target: { port: number; url: string; token: string; printerId: string },
    options: { sizeBytes: number; expectContinue?: boolean },
  ) {
    const request = http.request({
      host: "127.0.0.1",
      port: target.port,
      method: "PUT",
      path: `/api/printers/${target.printerId}/files/part.gcode`,
      headers: {
        cookie: `${SESSION_COOKIE}=${target.token}`,
        origin: target.url,
        "content-type": "application/octet-stream",
        "content-length": String(options.sizeBytes),
        ...(options.expectContinue === true && { expect: "100-continue" }),
      },
    });
    // The server may close the connection while the body is still going.
    request.on("error", () => undefined);
    let continued = false;
    request.on("continue", () => {
      continued = true;
    });
    const response = new Promise<{ status: number; body: string }>(
      (resolve, reject) => {
        const timer = setTimeout(() => {
          reject(new Error("No response in time."));
        }, WAIT_MS);
        request.on("response", (message: IncomingMessage) => {
          let body = "";
          message.setEncoding("utf8");
          message.on("data", (chunk: string) => {
            body += chunk;
          });
          message.on("end", () => {
            clearTimeout(timer);
            resolve({ status: message.statusCode ?? 0, body });
          });
        });
      },
    );
    return { request, response, continued: () => continued };
  }

  async function goOffline(t: Awaited<ReturnType<typeof served>>) {
    t.t.drivers.latest(t.printerId).emit({
      type: "status",
      status: "offline",
      detail: null,
      error: null,
    });
    await waitUntil(
      () => t.t.store.get(t.printerId)?.state.status === "offline",
    );
  }

  it("answers an upload refused before its body is read without waiting for the body, then closes the connection", async () => {
    const target = await served();
    await goOffline(target);
    const { request, response } = upload(target, { sizeBytes: 100 * MiB });
    const socketClosed = new Promise<void>((resolve) => {
      request.on("socket", (socket) => {
        socket.on("close", () => {
          resolve();
        });
      });
    });

    request.write(Buffer.alloc(64 * 1024));
    const answer = await response;

    expect(answer.status).toBe(409);
    expect(JSON.parse(answer.body)).toMatchObject({
      error: { code: "printer_offline" },
    });
    // @hono/node-server reads (and discards) the rest for up to 500 ms, then
    // closes the connection rather than take 100 MiB.
    await Promise.race([
      socketClosed,
      new Promise((_, reject) =>
        setTimeout(() => {
          reject(new Error("The connection stayed open."));
        }, WAIT_MS),
      ),
    ]);
    expect(await readdir(target.t.paths.staging)).toEqual([]);
  });

  it("answers a refused upload sent with Expect: 100-continue without asking for its body", async () => {
    const target = await served();
    await goOffline(target);
    const { request, response, continued } = upload(target, {
      sizeBytes: 100 * MiB,
      expectContinue: true,
    });

    request.flushHeaders();
    const answer = await response;

    expect(answer.status).toBe(409);
    expect(continued()).toBe(false);
  });

  it("asks for an accepted upload's body with 100 Continue, then takes it", async () => {
    const target = await served();
    const content = "G28\nG1 X10\n";
    const { request, response, continued } = upload(target, {
      sizeBytes: Buffer.byteLength(content),
      expectContinue: true,
    });
    request.on("continue", () => {
      request.end(content);
    });

    request.flushHeaders();
    const answer = await response;

    expect(answer.status).toBe(200);
    expect(continued()).toBe(true);
    const sent = target.t.drivers
      .latest(target.printerId)
      .calls.find((call) => call.op === "sendFile");
    expect(sent?.args).toMatchObject({ fileName: "part.gcode" });
  });

  it("asks for a JSON body with 100 Continue too", async () => {
    const target = await served();
    const body = JSON.stringify({ username: "rob", password: "wrong" });
    const request = http.request({
      host: "127.0.0.1",
      port: target.port,
      method: "POST",
      path: "/api/auth/login",
      headers: {
        origin: target.url,
        "content-type": "application/json",
        "content-length": String(Buffer.byteLength(body)),
        expect: "100-continue",
      },
    });
    let continued = false;
    request.on("continue", () => {
      continued = true;
      request.end(body);
    });
    request.flushHeaders();

    const [message] = (await once(request, "response")) as [IncomingMessage];
    message.resume();

    expect(message.statusCode).toBe(401);
    expect(continued).toBe(true);
  });
});
