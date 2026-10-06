// SPDX-FileCopyrightText: 2026 Open Print Stack contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { EventEmitter } from "node:events";

import { describe, expect, it, onTestFinished, vi } from "vitest";

import {
  exitOnCrash,
  SHUTDOWN_TIMEOUT_MS,
  stopOnSignals,
} from "./lifecycle.ts";
import { debugLogger, jsonLines } from "./test-utils.ts";

async function setup() {
  vi.useFakeTimers();
  onTestFinished(() => {
    vi.useRealTimers();
  });
  const { logger, output } = await debugLogger();
  const events = new EventEmitter();
  const exit = vi.fn<(code: number) => void>();
  let finish: (() => void) | undefined;
  let fail: ((error: Error) => void) | undefined;
  const stop = vi.fn(
    () =>
      new Promise<void>((resolve, reject) => {
        finish = resolve;
        fail = reject;
      }),
  );
  stopOnSignals({ logger, events, exit, stop });
  return {
    events,
    exit,
    stop,
    logs: () =>
      jsonLines(output).map((line) => [line.level, line.msg, line.signal]),
    finish: () => finish?.(),
    fail: (error: Error) => fail?.(error),
  };
}

describe("stopOnSignals", () => {
  it("allows 10 s for a shutdown", () => {
    expect(SHUTDOWN_TIMEOUT_MS).toBe(10_000);
  });

  it.each(["SIGTERM", "SIGINT"] as const)(
    "stops the server on %s, then exits 0",
    async (signal) => {
      const t = await setup();

      t.events.emit(signal, signal);
      expect(t.stop).toHaveBeenCalledOnce();
      await vi.advanceTimersByTimeAsync(9_000);
      expect(t.exit).not.toHaveBeenCalled();
      t.finish();
      await vi.advanceTimersByTimeAsync(0);

      expect(t.exit.mock.calls).toEqual([[0]]);
      expect(t.logs()).toEqual([["info", `${signal}: shutting down`, signal]]);
      // The timer was cleared: nothing more happens at 10 s.
      await vi.advanceTimersByTimeAsync(10_000);
      expect(t.exit.mock.calls).toEqual([[0]]);
    },
  );

  it("exits 1 at once on a second signal, without stopping again", async () => {
    const t = await setup();

    t.events.emit("SIGTERM", "SIGTERM");
    t.events.emit("SIGINT", "SIGINT");

    expect(t.stop).toHaveBeenCalledOnce();
    expect(t.exit.mock.calls).toEqual([[1]]);
    expect(t.logs().at(-1)).toEqual([
      "warn",
      "A second signal: exiting without finishing",
      "SIGINT",
    ]);
  });

  it("exits 1 if shutting down takes longer than 10 s", async () => {
    const t = await setup();

    t.events.emit("SIGTERM", "SIGTERM");
    await vi.advanceTimersByTimeAsync(9_999);
    expect(t.exit).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);

    expect(t.exit.mock.calls).toEqual([[1]]);
    expect(t.logs().at(-1)).toEqual([
      "error",
      "Shutting down took too long; exiting anyway",
      undefined,
    ]);
  });

  it("exits 1 if shutting down fails", async () => {
    const t = await setup();

    t.events.emit("SIGTERM", "SIGTERM");
    t.fail(new Error("The database is locked."));
    await vi.advanceTimersByTimeAsync(0);

    expect(t.exit.mock.calls).toEqual([[1]]);
    expect(t.logs().at(-1)).toEqual([
      "fatal",
      "Shutting down failed",
      undefined,
    ]);
  });
});

describe("exitOnCrash", () => {
  async function crashSetup() {
    const { logger, output } = await debugLogger();
    const events = new EventEmitter();
    const exit = vi.fn<(code: number) => void>();
    exitOnCrash({ logger, events, exit });
    return { events, exit, lines: () => jsonLines(output) };
  }

  it("logs an uncaught exception as fatal and exits 1", async () => {
    const t = await crashSetup();

    t.events.emit("uncaughtException", new Error("Oops"));

    expect(t.exit.mock.calls).toEqual([[1]]);
    expect(t.lines()).toEqual([
      expect.objectContaining({
        level: "fatal",
        component: "process",
        msg: "An uncaught exception; exiting",
        err: expect.objectContaining({ message: "Oops" }) as unknown,
      }) as unknown,
    ]);
  });

  it("logs an unhandled rejection as fatal and exits 1", async () => {
    const t = await crashSetup();

    t.events.emit("unhandledRejection", new Error("Nobody caught me"));

    expect(t.exit.mock.calls).toEqual([[1]]);
    expect(t.lines()).toEqual([
      expect.objectContaining({
        level: "fatal",
        msg: "An unhandled promise rejection; exiting",
        err: expect.objectContaining({
          message: "Nobody caught me",
        }) as unknown,
      }) as unknown,
    ]);
  });
});
