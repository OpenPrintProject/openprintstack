// SPDX-FileCopyrightText: 2026 Open Print Stack contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { PrinterSnapshot } from "@openprintstack/protocol";

import { Alert, AlertDescription } from "../../components/ui/alert.tsx";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "../../components/ui/alert-dialog.tsx";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "../../components/ui/card.tsx";
import { useCommand, useCommandLock } from "../api.ts";
import { formatDuration, formatPercent, NOT_REPORTED } from "../format.ts";
import { commandGate, withLock } from "../gating.ts";
import { JobProgressBar } from "../parts.tsx";
import { GatedButton } from "./controls.tsx";

// The printer's error, its job (progress, times, layers, speed), and Pause,
// Resume and Cancel. Prints start from the Files card. Cancel asks first: a
// cancelled job can't be resumed.

export function PrintCard({ snapshot }: { snapshot: PrinterSnapshot }) {
  const { printer, state } = snapshot;
  const { job, speedPercent } = state.telemetry;
  const locked = useCommandLock(printer.id);
  const pause = useCommand(printer.id, () => "Couldn't pause the print");
  const resume = useCommand(printer.id, () => "Couldn't resume the print");
  const cancel = useCommand(printer.id, () => "Couldn't cancel the print");
  const cancelGate = withLock(commandGate(state, "print.cancel"), locked);

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2>Print</h2>
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {state.error !== null && (
          <Alert variant="destructive">
            <AlertDescription>{state.error.message}</AlertDescription>
          </Alert>
        )}
        {job === null ? (
          <p className="text-sm text-muted-foreground">
            No job. Start one from the files below.
          </p>
        ) : (
          <>
            <JobProgressBar job={job} />
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
              <dt className="text-muted-foreground">Elapsed</dt>
              <dd>{formatDuration(job.elapsedS)}</dd>
              <dt className="text-muted-foreground">Remaining</dt>
              <dd>{formatDuration(job.remainingS)}</dd>
              <dt className="text-muted-foreground">Layer</dt>
              <dd>
                {job.currentLayer === null
                  ? NOT_REPORTED
                  : job.totalLayers === null
                    ? job.currentLayer
                    : `${job.currentLayer} of ${job.totalLayers}`}
              </dd>
              <dt className="text-muted-foreground">Speed</dt>
              <dd>{formatPercent(speedPercent)}</dd>
            </dl>
          </>
        )}
        <div className="flex flex-wrap gap-2">
          <GatedButton
            variant="outline"
            gate={withLock(commandGate(state, "print.pause"), locked)}
            pending={pause.isPending}
            onClick={() => {
              pause.run({ kind: "print.pause" });
            }}
          >
            Pause
          </GatedButton>
          <GatedButton
            variant="outline"
            gate={withLock(commandGate(state, "print.resume"), locked)}
            pending={resume.isPending}
            onClick={() => {
              resume.run({ kind: "print.resume" });
            }}
          >
            Resume
          </GatedButton>
          {cancelGate.shown && (
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <GatedButton
                  variant="destructive"
                  gate={cancelGate}
                  pending={cancel.isPending}
                >
                  Cancel
                </GatedButton>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>
                    {job === null
                      ? "Cancel the printer's job?"
                      : `Cancel the print of ${job.fileName}?`}
                  </AlertDialogTitle>
                  <AlertDialogDescription>
                    A cancelled job can't be resumed.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Keep printing</AlertDialogCancel>
                  <AlertDialogAction
                    variant="destructive"
                    onClick={() => {
                      cancel.run({ kind: "print.cancel" });
                    }}
                  >
                    Cancel the print
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
