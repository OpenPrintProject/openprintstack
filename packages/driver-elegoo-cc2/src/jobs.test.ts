// SPDX-FileCopyrightText: 2026 Open Print Stack contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from "vitest";

import { type JobMemory, NO_JOBS, trackJobs } from "./jobs.ts";
import type { JsonObject } from "./protocol.ts";

const UUID = "b52af24c-764e-4092-8a50-00e5f8f02b46";
const OTHER = "0e5c1f8a-2a5b-4d33-9b7e-1c2d3e4f5a6b";

function status(
  code: number,
  sub = 0,
  print: JsonObject = { uuid: UUID, filename: "benchy.gcode" },
): JsonObject {
  return {
    machine_status: { status: code, sub_status: sub },
    print_status: print,
  };
}

const running: JobMemory = {
  job: { uuid: UUID, fileName: "benchy.gcode" },
  endedUuid: null,
};

describe("trackJobs", () => {
  it("starts a job when a print with a new uuid appears", () => {
    expect(trackJobs(NO_JOBS, status(2, 1045))).toEqual({
      memory: running,
      changes: [
        { event: "started", fileName: "benchy.gcode", unreported: false },
      ],
    });
  });

  it("says nothing while the same job goes on", () => {
    for (const sub of [1405, 2075, 2501, 2502, 2401, 2503]) {
      expect(trackJobs(running, status(2, sub))).toEqual({
        memory: running,
        changes: [],
      });
    }
  });

  it.each([
    [2077, "completed"],
    [2504, "cancelled"],
  ] as const)("ends a job at sub-status %i as %s", (sub, outcome) => {
    expect(trackJobs(running, status(2, sub))).toEqual({
      memory: { job: null, endedUuid: UUID },
      changes: [
        { event: outcome, fileName: "benchy.gcode", unreported: false },
      ],
    });
  });

  it("fails a job at an emergency stop", () => {
    expect(trackJobs(running, status(14)).changes).toEqual([
      { event: "failed", fileName: "benchy.gcode", unreported: false },
    ]);
  });

  it.each([
    ["complete", "completed"],
    ["cancelled", "cancelled"],
    ["error", "failed"],
  ] as const)(
    "ends a job the idle printer still shows as %s",
    (state, outcome) => {
      const idle = status(1, 0, { uuid: UUID, filename: "x", state });

      expect(trackJobs(running, idle).changes).toEqual([
        { event: outcome, fileName: "benchy.gcode", unreported: false },
      ]);
    },
  );

  it("fails a job that has gone when the printer doesn't say how it ended", () => {
    const idle = status(1, 0, { uuid: "", filename: "" });

    expect(trackJobs(running, idle)).toEqual({
      memory: { job: null, endedUuid: UUID },
      changes: [
        { event: "failed", fileName: "benchy.gcode", unreported: true },
      ],
    });
  });

  it("ends a job that has gone, then starts the new one", () => {
    const next = status(2, 2075, { uuid: OTHER, filename: "cube.gcode" });

    expect(trackJobs(running, next)).toEqual({
      memory: { job: { uuid: OTHER, fileName: "cube.gcode" }, endedUuid: UUID },
      changes: [
        { event: "failed", fileName: "benchy.gcode", unreported: true },
        { event: "started", fileName: "cube.gcode", unreported: false },
      ],
    });
  });

  it("waits while the printer is busy without a job (e.g. starting up)", () => {
    for (const code of [0, 15, 10]) {
      expect(trackJobs(running, status(code, 0, {})).changes).toEqual([]);
    }
  });

  it("doesn't start a job that has already ended", () => {
    const ended: JobMemory = { job: null, endedUuid: UUID };

    // E.g. the sub-status leaves 2077 while the printer still says printing.
    expect(trackJobs(ended, status(2, 0))).toEqual({
      memory: ended,
      changes: [],
    });
  });

  it("doesn't start a job for a print that's already over", () => {
    for (const sub of [2077, 2504]) {
      expect(trackJobs(NO_JOBS, status(2, sub)).changes).toEqual([]);
    }
    expect(trackJobs(NO_JOBS, status(14)).changes).toEqual([]);
  });

  it("doesn't start a job without a uuid", () => {
    expect(
      trackJobs(NO_JOBS, status(2, 2075, { filename: "a.gcode" })),
    ).toEqual({ memory: NO_JOBS, changes: [] });
  });

  it("names a job without a file name", () => {
    expect(
      trackJobs(NO_JOBS, status(2, 2075, { uuid: UUID })).memory.job,
    ).toEqual({ uuid: UUID, fileName: "Unknown file" });
  });
});
