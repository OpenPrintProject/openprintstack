// SPDX-FileCopyrightText: 2026 Open Print Stack contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { hasActiveJob, type PrinterSnapshot } from "@openprintstack/protocol";
import { useNavigate } from "@tanstack/react-router";
import { Trash2Icon } from "lucide-react";

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
import { Button } from "../../components/ui/button.tsx";
import { Spinner } from "../../components/ui/spinner.tsx";
import { toastFailure, useApi } from "../api.ts";

// Delete, after a confirmation that names the printer. The server allows it
// during a job: it stops the printer's driver, which disconnects it.

/** What deleting a printer with a job means, for any kind of printer. */
export function jobWarning(snapshot: PrinterSnapshot): string | null {
  const { status, telemetry } = snapshot.state;
  if (!hasActiveJob(status)) return null;
  const printing =
    telemetry.job === null
      ? "It has a job."
      : `It's printing ${telemetry.job.fileName}.`;
  return `${printing} Deleting disconnects it, so this app can't pause or cancel that job afterwards.`;
}

export function DeletePrinter({ snapshot }: { snapshot: PrinterSnapshot }) {
  const { printer } = snapshot;
  const api = useApi();
  const navigate = useNavigate();
  const mutation = api.query.useMutation("delete", "/api/printers/{id}", {
    onSuccess: () => navigate({ to: "/" }),
    onError: (error) => {
      toastFailure(`Couldn't delete ${printer.name}`, error);
    },
  });
  const warning = jobWarning(snapshot);

  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button variant="destructive">
          <Trash2Icon data-icon="inline-start" />
          Delete
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete {printer.name}?</AlertDialogTitle>
          <AlertDialogDescription>
            Its files on the server are deleted; its event history is kept.
            {warning !== null && ` ${warning}`}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={mutation.isPending}>
            Keep it
          </AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            disabled={mutation.isPending}
            onClick={(event) => {
              // Stay open until the server answers.
              event.preventDefault();
              mutation.mutate({ params: { path: { id: printer.id } } });
            }}
          >
            {mutation.isPending && (
              <Spinner data-icon="inline-start" aria-hidden />
            )}
            Delete
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
