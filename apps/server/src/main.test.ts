// SPDX-FileCopyrightText: 2026 Open Print Stack contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

// main.ts run as the real thing: a child Node process, with only the
// environment given here. Everything it wires up is tested in-process
// through startServer() and lifecycle.ts; these check the wiring itself.

import { once } from "node:events";
import { existsSync } from "node:fs";
import net from "node:net";
import path from "node:path";

import { describe, expect, it, onTestFinished } from "vitest";

import { openDatabase } from "./db/client.ts";
import { runNode } from "./test-process.ts";
import { tempDir } from "./test-utils.ts";
import { TestClient } from "./ws/test-client.ts";

const MAIN = path.join(import.meta.dirname, "main.ts");

/**
 * Preloaded with --import, so the tests can make the server crash once it's
 * running: SIGUSR2 throws an uncaught exception, SIGHUP leaves a promise
 * rejection unhandled.
 */
const CRASH_PRELOAD = `data:text/javascript,${encodeURIComponent(`
process.on("SIGUSR2", () => {
  setImmediate(() => { throw new Error("A bug that escaped every handler"); });
});
process.on("SIGHUP", () => {
  void Promise.reject(new Error("A rejection nobody handled"));
});
`)}`;

/** Generous: each run starts a fresh Node process. */
const TIMEOUT_MS = 20_000;

function run(
  env: Record<string, string>,
  nodeOptions: string[] = [],
  options: { cwd?: string } = {},
) {
  return runNode([...nodeOptions, MAIN], env, {
    ...options,
    waitMs: TIMEOUT_MS / 2,
  });
}

async function serverEnv(): Promise<Record<string, string>> {
  return { OPS_DATA_DIR: await tempDir(), OPS_PORT: "0" };
}

function storedTypes(dataDir: string): string[] {
  const db = openDatabase(path.join(dataDir, "ops.sqlite"));
  try {
    return db.$client
      .prepare("SELECT type FROM events ORDER BY row_id")
      .pluck()
      .all() as string[];
  } finally {
    db.$client.close();
  }
}

describe("main.ts", { timeout: TIMEOUT_MS }, () => {
  it("prints every configuration problem to stderr and exits 1", async () => {
    const main = run({ OPS_PORT: "abc", OPS_LOG_LEVEL: "loud" });

    expect(await main.exited).toBe(1);
    expect(main.stderr()).toBe(
      [
        "Invalid configuration:",
        '  OPS_LOG_LEVEL must be silent, fatal, error, warn, info, debug or trace (got "loud")',
        '  OPS_PORT must be a whole number from 0 to 65535 (got "abc")',
        "",
      ].join("\n"),
    );
    expect(main.stdout()).toBe("");
  });

  it("shuts down on SIGTERM and exits 0", async () => {
    const env = await serverEnv();
    const main = run(env);
    const listening = await main.waitForLog("Listening on");

    main.child.kill("SIGTERM");

    expect(await main.exited).toBe(0);
    expect(listening.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
    const messages = main.lines().map((line) => line.msg);
    expect(messages.slice(-3)).toEqual([
      "SIGTERM: shutting down",
      "Shutting down",
      "Stopped",
    ]);
    expect(storedTypes(env.OPS_DATA_DIR!)).toEqual([
      "system.started",
      "system.stopping",
    ]);
  });

  it("resolves a relative OPS_DATA_DIR from INIT_CWD, the folder pnpm was run in", async () => {
    const launched = await tempDir();
    const working = await tempDir();
    const main = run(
      { OPS_DATA_DIR: "data", OPS_PORT: "0", INIT_CWD: launched },
      [],
      { cwd: working },
    );
    await main.waitForLog("Listening on");

    main.child.kill("SIGTERM");

    expect(await main.exited).toBe(0);
    expect(existsSync(path.join(launched, "data", "ops.sqlite"))).toBe(true);
    expect(existsSync(path.join(working, "data"))).toBe(false);
  });

  it.each([
    ["without INIT_CWD", {}],
    ["with an empty INIT_CWD", { INIT_CWD: "" }],
  ])(
    "resolves a relative OPS_DATA_DIR from its working directory %s",
    async (_, initCwd: Record<string, string>) => {
      const working = await tempDir();
      const main = run(
        { OPS_DATA_DIR: "data", OPS_PORT: "0", ...initCwd },
        [],
        { cwd: working },
      );
      await main.waitForLog("Listening on");

      main.child.kill("SIGTERM");

      expect(await main.exited).toBe(0);
      expect(existsSync(path.join(working, "data", "ops.sqlite"))).toBe(true);
    },
  );

  it("exits 1 with a clear message when the port is taken", async () => {
    const taken = net.createServer();
    taken.listen(0, "127.0.0.1");
    await once(taken, "listening");
    onTestFinished(() => {
      taken.close();
    });
    const port = (taken.address() as net.AddressInfo).port;
    const main = run({ ...(await serverEnv()), OPS_PORT: String(port) });

    const msg = `The server couldn't start: Port ${port} on 127.0.0.1 is already in use. Stop whatever is using it, or set OPS_PORT to another port.`;

    expect(await main.exited).toBe(1);
    expect(main.logged(msg)).toMatchObject({ level: "fatal", msg });
  });

  it.each([
    [
      "an uncaught exception",
      "SIGUSR2",
      "An uncaught exception; exiting",
      "A bug that escaped every handler",
    ],
    [
      "an unhandled rejection",
      "SIGHUP",
      "An unhandled promise rejection; exiting",
      "A rejection nobody handled",
    ],
  ] as const)(
    "logs %s as fatal and exits 1",
    async (_name, signal, msg, message) => {
      const main = run(await serverEnv(), ["--import", CRASH_PRELOAD]);
      await main.waitForLog("Listening on");

      main.child.kill(signal);

      expect(await main.exited).toBe(1);
      expect(main.logged(msg)).toMatchObject({
        level: "fatal",
        component: "process",
        msg,
        err: { message },
      });
    },
  );

  it("exits 1 at once on a second signal during the shutdown", async () => {
    const main = run(await serverEnv());
    const { url } = (await main.waitForLog("Listening on")) as { url: string };
    const setup = await fetch(`${url}/api/auth/setup`, {
      method: "POST",
      headers: { origin: url, "content-type": "application/json" },
      body: JSON.stringify({ username: "rob", password: "correct horse 1" }),
    });
    const token = /ops_session=([^;]*)/.exec(
      setup.headers.get("set-cookie") ?? "",
    )?.[1];
    // A client that stops reading never answers the close, so the shutdown
    // waits the hub's 2 s grace for it: time for a second signal.
    const client = await TestClient.connect(url, {
      ...(token !== undefined && { token }),
    });
    client.socket.pause();

    main.child.kill("SIGTERM");
    await main.waitForLog("SIGTERM: shutting down");
    const signalled = performance.now();
    main.child.kill("SIGINT");

    expect(await main.exited).toBe(1);
    expect(performance.now() - signalled).toBeLessThan(1500);
    expect(
      main.logged("A second signal: exiting without finishing"),
    ).toMatchObject({ level: "warn", signal: "SIGINT" });
  });
});
