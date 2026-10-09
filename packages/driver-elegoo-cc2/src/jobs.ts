// SPDX-FileCopyrightText: 2026 Open Print Stack contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { JobLifecycleEvent } from "@openprintstack/driver-sdk";
import type { JobOutcome } from "@openprintstack/protocol";
import { z } from "zod";

import type { JsonObject } from "./protocol.ts";
import { numberAt, objectAt, stringAt } from "./read.ts";
import { MACHINE, SUB } from "./status-map.ts";
import { readPrint, UNKNOWN_FILE } from "./telemetry.ts";

// Jobs as the printer reports them: a job starts when a print with a new
// `uuid` appears, and ends as completed (2077), cancelled (2504) or failed (an
// emergency stop during the print). The driver keeps this memory on disk, so a
// reconnect or a server restart mid-print doesn't announce the job twice.

const RememberedJob = z.object({
  uuid: z.string().min(1),
  fileName: z.string().min(1),
});

export type RememberedJob = z.infer<typeof RememberedJob>;

/** What the driver remembers about jobs, across restarts. */
export const JobMemory = z.object({
  /** The job that has started and not yet ended. */
  job: RememberedJob.nullable(),
  /** The last job that ended, so it isn't started again. */
  endedUuid: z.string().min(1).nullable(),
});

export type JobMemory = z.infer<typeof JobMemory>;

export const NO_JOBS: JobMemory = { job: null, endedUuid: null };

export type JobChange = {
  readonly event: JobLifecycleEvent;
  readonly fileName: string;
  /** True when the job had gone and the printer didn't say how it ended. */
  readonly unreported: boolean;
};

/** Klipper's own word for how a print ended, which the CC2 may pass on. */
const STATES: Readonly<Record<string, JobOutcome>> = {
  complete: "completed",
  cancelled: "cancelled",
  error: "failed",
};

/** How the print the printer reports has ended, or null if it hasn't. */
function outcomeOf(status: JsonObject): JobOutcome | null {
  const machine = objectAt(status, "machine_status");
  const code = numberAt(machine, "status");
  const sub = numberAt(machine, "sub_status");
  if (code === MACHINE.printing && sub === SUB.completed) return "completed";
  if (code === MACHINE.printing && sub === SUB.stopped) return "cancelled";
  if (code === MACHINE.emergencyStop) return "failed";
  const state = stringAt(objectAt(status, "print_status"), "state");
  return state === null ? null : (STATES[state] ?? null);
}

/** The new memory and the job events one status brings. */
export function trackJobs(
  memory: JobMemory,
  status: JsonObject,
): { memory: JobMemory; changes: JobChange[] } {
  const code = numberAt(objectAt(status, "machine_status"), "status");
  const print = readPrint(status);
  const outcome = outcomeOf(status);
  const changes: JobChange[] = [];
  let { job, endedUuid } = memory;

  if (job !== null) {
    if (print.uuid === job.uuid) {
      if (outcome !== null) {
        changes.push({
          event: outcome,
          fileName: job.fileName,
          unreported: false,
        });
        endedUuid = job.uuid;
        job = null;
      }
      // Otherwise it's still going, or the printer is busy with it (e.g.
      // recovering from a power cut).
    } else if (print.uuid !== null || code === MACHINE.idle) {
      // Another print, or an idle printer: the job ended while we weren't
      // watching, and the printer no longer says how.
      changes.push({
        event: "failed",
        fileName: job.fileName,
        unreported: true,
      });
      endedUuid = job.uuid;
      job = null;
    }
  }

  const printing = code === MACHINE.printing && outcome === null;
  if (
    job === null &&
    printing &&
    print.uuid !== null &&
    print.uuid !== endedUuid
  ) {
    job = { uuid: print.uuid, fileName: print.fileName ?? UNKNOWN_FILE };
    changes.push({
      event: "started",
      fileName: job.fileName,
      unreported: false,
    });
  }

  return { memory: { job, endedUuid }, changes };
}
