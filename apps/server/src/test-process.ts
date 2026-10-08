// SPDX-FileCopyrightText: 2026 Open Print Stack contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

// A Node process for the tests that run the server as the real thing
// (main.test.ts and production.smoke.ts): its JSON log lines as they arrive,
// and how it exited. Not used by the server itself.

import { spawn } from "node:child_process";
import { once } from "node:events";

import { onTestFinished } from "vitest";

export type Line = Record<string, unknown>;

export type RunNodeOptions = {
  /** The working directory: this process's by default. */
  cwd?: string;
  /** How long `waitForLog` waits: 10 s by default. */
  waitMs?: number;
};

/**
 * Runs `node <args>` with only `env` (plus PATH and HOME, and SYSTEMROOT on
 * Windows), and kills it when the test finishes if it's still running.
 */
export function runNode(
  args: string[],
  env: Record<string, string>,
  options: RunNodeOptions = {},
) {
  const child = spawn(process.execPath, args, {
    // Nothing from this process's environment but what Node needs. On
    // Windows that includes SYSTEMROOT, without which sockets fail.
    env: {
      PATH: process.env.PATH ?? "",
      HOME: process.env.HOME ?? "",
      ...(process.env.SYSTEMROOT !== undefined && {
        SYSTEMROOT: process.env.SYSTEMROOT,
      }),
      ...env,
    },
    stdio: ["ignore", "pipe", "pipe"],
    ...(options.cwd !== undefined && { cwd: options.cwd }),
  });
  let stdout = "";
  let stderr = "";
  const waiters = new Set<() => void>();
  child.stdout.setEncoding("utf8").on("data", (chunk: string) => {
    stdout += chunk;
    for (const wake of [...waiters]) wake();
  });
  child.stderr.setEncoding("utf8").on("data", (chunk: string) => {
    stderr += chunk;
  });
  // "close", not "exit": when "exit" fires, the child's stdio may still be
  // open, with its last log lines unread.
  const exited = once(child, "close").then(([code]) => code as number | null);
  // Waits for the exit, so the process has let go of its files before the
  // test's temporary folders are removed: Windows can't delete open files.
  onTestFinished(async () => {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill("SIGKILL");
    }
    await exited;
  });

  const lines = (): Line[] =>
    stdout
      .split("\n")
      .filter((line) => line.startsWith("{"))
      .map((line) => JSON.parse(line) as Line);

  /** Waits for a log line whose msg starts with `prefix`. */
  function waitForLog(prefix: string): Promise<Line> {
    return new Promise((resolve, reject) => {
      const check = () => {
        const line = lines().find((l) => String(l.msg).startsWith(prefix));
        if (line === undefined) return false;
        clearTimeout(timer);
        waiters.delete(wake);
        resolve(line);
        return true;
      };
      const wake = () => {
        check();
      };
      const timer = setTimeout(() => {
        waiters.delete(wake);
        reject(
          new Error(
            `No "${prefix}" line in time. stdout: ${stdout} stderr: ${stderr}`,
          ),
        );
      }, options.waitMs ?? 10_000);
      if (!check()) waiters.add(wake);
    });
  }

  /**
   * The log line with this message. When the process exits at once, an
   * earlier line's write can still be in flight and land after this one (the
   * logger writes stdout asynchronously, and the exit flushes what's queued
   * first), so it needn't be the last line.
   */
  const logged = (msg: string): Line | undefined =>
    lines().find((line) => line.msg === msg);

  return {
    child,
    exited,
    lines,
    logged,
    waitForLog,
    stdout: () => stdout,
    stderr: () => stderr,
  };
}
