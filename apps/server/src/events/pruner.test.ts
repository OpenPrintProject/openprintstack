// SPDX-FileCopyrightText: 2026 Open Print Stack contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { type OpsEvent } from "@openprintstack/protocol";
import { eventFixtures, eventId } from "@openprintstack/protocol/fixtures";
import { asc } from "drizzle-orm";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  onTestFinished,
  vi,
} from "vitest";

import type { Db } from "../db/client.ts";
import { createRepos, type Repos } from "../db/repos/index.ts";
import { events } from "../db/schema.ts";
import { debugLogger, jsonLines, testDatabase } from "../test-utils.ts";
import { Pruner, type PrunerOptions } from "./pruner.ts";

const DAY = 24 * 60 * 60 * 1000;
const HOUR = 60 * 60 * 1000;
const NOW = Date.parse("2026-10-05T12:00:00.000Z");
/** Telemetry from before this is pruned, with the default 7 days. */
const CUTOFF = NOW - 7 * DAY;

// Timers are fake, but setImmediate (the pause between batches) is Node's own.
beforeEach(() => {
  vi.useFakeTimers({
    now: NOW,
    toNotFake: ["setImmediate", "clearImmediate"],
  });
});

afterEach(() => {
  vi.useRealTimers();
});

let nextSeq = 1;

/** A copy of the fixture with its own id and seq, at `ms`. */
function at<T extends OpsEvent>(fixture: T, ms: number): T {
  const seq = nextSeq++;
  return { ...fixture, id: eventId(seq), seq, ts: new Date(ms).toISOString() };
}

const telemetry = (ms: number) => at(eventFixtures["printer.telemetry"], ms);

async function setup(options: Partial<PrunerOptions> = {}) {
  const db = await testDatabase();
  const repos = createRepos(db);
  const { logger, output } = await debugLogger();
  const deletes = vi.spyOn(repos.events, "deleteTelemetryBefore");
  const pruner = new Pruner({ repos, logger, retentionDays: 7, ...options });
  return { db, repos, pruner, deletes, output };
}

/** The stored events' timestamps (ms) and types, in row order. */
function stored(db: Db): [number, string][] {
  return db
    .select({ ts: events.ts, type: events.type })
    .from(events)
    .orderBy(asc(events.rowId))
    .all()
    .map((row) => [row.ts, row.type]);
}

function addSession(repos: Repos, id: string, expiresAt: number): void {
  const userId =
    repos.users.findByUsername("rob")?.id ??
    repos.users.create({ username: "rob", passwordHash: "h", now: 0 }).id;
  repos.sessions.create({
    id,
    userId,
    now: 0,
    expiresAt,
    ip: null,
    userAgent: null,
  });
}

describe("Pruner", () => {
  it("deletes telemetry from before the retention period, and nothing else", async () => {
    const { db, repos, pruner } = await setup();
    const old = CUTOFF - DAY;
    repos.events.insertMany([
      ...Object.values(eventFixtures).map((fixture) => at(fixture, old)),
      telemetry(CUTOFF - 1),
      telemetry(CUTOFF),
      telemetry(NOW),
    ]);

    await pruner.start();

    expect(stored(db)).toEqual([
      ...Object.values(eventFixtures)
        .filter((fixture) => fixture.category !== "telemetry")
        .map((fixture) => [old, fixture.type]),
      [CUTOFF, "printer.telemetry"],
      [NOW, "printer.telemetry"],
    ]);
  });

  it("uses the configured retention", async () => {
    const { db, repos, pruner } = await setup({ retentionDays: 1 });
    repos.events.insertMany([telemetry(NOW - DAY - 1), telemetry(NOW - DAY)]);

    await pruner.start();

    expect(stored(db)).toEqual([[NOW - DAY, "printer.telemetry"]]);
  });

  it("deletes in batches, letting other work run between them", async () => {
    const { db, repos, pruner, deletes } = await setup({ batchSize: 2 });
    repos.events.insertMany([1, 2, 3, 4, 5].map((n) => telemetry(CUTOFF - n)));

    const run = pruner.start();
    // The first batch runs at once; the rest wait for the event loop.
    expect(stored(db)).toHaveLength(3);
    let leftWhenOtherWorkRan: number | undefined;
    setImmediate(() => {
      leftWhenOtherWorkRan = stored(db).length;
    });
    await run;

    expect(leftWhenOtherWorkRan).toBeGreaterThan(0);
    expect(stored(db)).toEqual([]);
    expect(deletes).toHaveBeenCalledTimes(3);
    expect(deletes).toHaveNthReturnedWith(1, 2);
    expect(deletes).toHaveNthReturnedWith(2, 2);
    expect(deletes).toHaveNthReturnedWith(3, 1);
  });

  it("deletes expired sessions, including one that expires exactly now", async () => {
    const { repos, pruner } = await setup();
    addSession(repos, "expired", NOW - 1);
    addSession(repos, "expires-now", NOW);
    addSession(repos, "current", NOW + 1);

    await pruner.start();

    expect(repos.sessions.findById("expired")).toBeUndefined();
    expect(repos.sessions.findById("expires-now")).toBeUndefined();
    expect(repos.sessions.findById("current")).toBeDefined();
  });

  it("runs again an hour after each run ends", async () => {
    const { db, repos, pruner, deletes } = await setup();
    await pruner.start();
    repos.events.insertMany([telemetry(NOW - 7 * DAY + HOUR - 1)]);

    await vi.advanceTimersByTimeAsync(HOUR - 1);

    expect(deletes).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1);

    expect(deletes).toHaveBeenCalledTimes(2);
    // The cutoff moved on with the clock.
    expect(stored(db)).toEqual([]);

    await vi.advanceTimersByTimeAsync(HOUR);

    expect(deletes).toHaveBeenCalledTimes(3);
  });

  it("schedules the next run on a timer that doesn't keep the process alive", async () => {
    const setTimeoutSpy = vi.spyOn(globalThis, "setTimeout");
    onTestFinished(() => {
      setTimeoutSpy.mockRestore();
    });
    const { pruner } = await setup();

    await pruner.start();

    expect(setTimeoutSpy).toHaveBeenCalledTimes(1);
    const timer = setTimeoutSpy.mock.results[0]!.value as NodeJS.Timeout;
    expect(timer.hasRef()).toBe(false);
  });

  it("stops: no more runs after stop()", async () => {
    const { pruner, deletes } = await setup();
    await pruner.start();

    await pruner.stop();
    await vi.advanceTimersByTimeAsync(3 * HOUR);

    expect(deletes).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("stops a run in progress after its current batch", async () => {
    const { db, repos, pruner, deletes } = await setup({ batchSize: 1 });
    repos.events.insertMany([1, 2, 3, 4, 5].map((n) => telemetry(CUTOFF - n)));
    void pruner.start();

    await pruner.stop();

    expect(deletes).toHaveBeenCalledTimes(1);
    expect(stored(db)).toHaveLength(4);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("can't be started twice", async () => {
    const { pruner } = await setup();
    await pruner.start();

    expect(() => pruner.start()).toThrow(
      "The pruner has already been started.",
    );
  });

  it("logs what it deleted, or at debug level that there was nothing", async () => {
    const { repos, pruner, output } = await setup();
    repos.events.insertMany([telemetry(CUTOFF - 1), telemetry(CUTOFF - 2)]);
    addSession(repos, "expired", NOW - 1);

    await pruner.start();
    await vi.advanceTimersByTimeAsync(HOUR);

    expect(jsonLines(output)).toMatchObject([
      {
        level: "info",
        component: "pruner",
        telemetry: 2,
        sessions: 1,
        cutoff: new Date(CUTOFF).toISOString(),
        msg: "Pruned old telemetry and expired sessions",
      },
      {
        level: "debug",
        component: "pruner",
        telemetry: 0,
        sessions: 0,
        msg: "Nothing to prune",
      },
    ]);
  });

  it("logs a failed run and tries again an hour later", async () => {
    const { repos, pruner, deletes, output } = await setup();
    deletes.mockImplementationOnce(() => {
      throw new Error("disk on fire");
    });

    await pruner.start();

    const [line] = jsonLines(output);
    expect(line).toMatchObject({
      level: "error",
      component: "pruner",
      msg: "Pruning failed",
    });
    expect(line!.err).toMatchObject({ message: "disk on fire" });

    repos.events.insertMany([telemetry(CUTOFF - 1)]);
    await vi.advanceTimersByTimeAsync(HOUR);

    expect(deletes).toHaveBeenCalledTimes(2);
    expect(deletes).toHaveNthReturnedWith(2, 1);
  });
});
