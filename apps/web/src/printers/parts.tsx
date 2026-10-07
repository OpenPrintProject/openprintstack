// SPDX-FileCopyrightText: 2026 Open Print Stack contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import type {
  Heater,
  JobProgress,
  PrinterState,
  TemperatureReading,
} from "@openprintstack/protocol";

import { Badge } from "../components/ui/badge.tsx";
import { Progress } from "../components/ui/progress.tsx";
import { formatPercent, formatTemperature } from "./format.ts";
import { STATUS_LABEL } from "./status.ts";

// Pieces of a printer's state that the list and the detail page both show.

/** The status as a badge (red in error), and its detail, e.g. "Heating up". */
export function PrinterStatusBadge({ state }: { state: PrinterState }) {
  return (
    <span className="flex flex-wrap items-center gap-2">
      <Badge variant={state.status === "error" ? "destructive" : "secondary"}>
        {STATUS_LABEL[state.status]}
      </Badge>
      {state.statusDetail !== null && (
        <span className="text-sm text-muted-foreground">
          {state.statusDetail}
        </span>
      )}
    </span>
  );
}

/** "214.6 °C / 215 °C"; a target of 0 is "off", and an unreported one left out. */
export function temperatureText(
  reading: TemperatureReading | undefined,
): string {
  const actual = formatTemperature(reading?.actualC ?? null);
  const target = reading?.targetC ?? null;
  if (target === null) return actual;
  return `${actual} / ${target === 0 ? "off" : formatTemperature(target)}`;
}

/** The heaters a printer's summary shows: its nozzles and beds. */
export function summaryHeaters(state: PrinterState): Heater[] {
  return (state.capabilities?.heaters ?? []).filter(
    (heater) => heater.kind === "nozzle" || heater.kind === "bed",
  );
}

/** The job's file and progress bar, with the percent. */
export function JobProgressBar({ job }: { job: JobProgress }) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between gap-2 text-sm">
        <span className="truncate font-medium" title={job.fileName}>
          {job.fileName}
        </span>
        <span className="text-muted-foreground tabular-nums">
          {formatPercent(job.progressPercent)}
        </span>
      </div>
      {/* No bar when the printer doesn't report progress: it isn't 0. */}
      {job.progressPercent !== null && (
        <Progress
          value={job.progressPercent}
          aria-label={`Progress of ${job.fileName}`}
        />
      )}
    </div>
  );
}
