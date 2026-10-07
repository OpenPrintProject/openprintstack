// SPDX-FileCopyrightText: 2026 Open Print Stack contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  isOnline,
  type PrinterFile,
  type PrinterSnapshot,
} from "@openprintstack/protocol";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { UploadIcon } from "lucide-react";
import { useRef } from "react";
import { toast } from "sonner";

import { errorMessage } from "../../api/errors.ts";
import {
  Card,
  CardAction,
  CardContent,
  CardHeader,
  CardTitle,
} from "../../components/ui/card.tsx";
import { useRealtimeEvents } from "../../realtime/provider.tsx";
import {
  filesQuery,
  toastFailure,
  useApi,
  useCommand,
  useCommandLock,
  useUploading,
} from "../api.ts";
import { formatBytes, formatDateTime } from "../format.ts";
import { commandGate, type Gate, uploadGate, withLock } from "../gating.ts";
import { acceptAttribute, uploadProblem } from "../uploads.ts";
import { GatedButton, GateHint } from "./controls.tsx";

// The printer's files, newest first, each with Print; and Upload. The list is
// asked for only while the printer is online (the server refuses it
// otherwise), and again on each printer.files_changed event.

const collator = new Intl.Collator(undefined, { numeric: true });

/** Newest first; files without a time last; then by name. */
export function byNewest(files: readonly PrinterFile[]): PrinterFile[] {
  return files.toSorted(
    (a, b) =>
      (b.modifiedAt ?? "").localeCompare(a.modifiedAt ?? "") ||
      collator.compare(a.name, b.name),
  );
}

export function FilesCard({ snapshot }: { snapshot: PrinterSnapshot }) {
  const { printer, state } = snapshot;
  const api = useApi();
  const queryClient = useQueryClient();
  const locked = useCommandLock(printer.id);
  const listed = state.capabilities?.files.list === true;
  const online = isOnline(state.status);
  const files = useQuery({
    ...filesQuery(api, printer.id),
    enabled: listed && online,
  });
  useRealtimeEvents((event) => {
    if (
      event.type === "printer.files_changed" &&
      event.printerId === printer.id
    ) {
      void queryClient.invalidateQueries({
        queryKey: filesQuery(api, printer.id).queryKey,
      });
    }
  });
  const print = useCommand(printer.id, (command) =>
    command.kind === "print.start"
      ? `Couldn't start ${command.fileName}`
      : "Couldn't start the print",
  );
  const upload = uploadGate(state);
  if (!listed && !upload.shown) return null;
  const printGate = withLock(commandGate(state, "print.start"), locked);

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2>Files</h2>
        </CardTitle>
        {upload.shown && state.capabilities !== null && (
          <CardAction>
            <UploadButton
              printerId={printer.id}
              printerName={printer.name}
              files={state.capabilities.files}
              gate={upload}
            />
          </CardAction>
        )}
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {listed &&
          (!online ? (
            <p className="text-sm text-muted-foreground">
              Files appear when the printer is online.
            </p>
          ) : files.isPending ? (
            <p className="text-sm text-muted-foreground">Loading files…</p>
          ) : files.isError ? (
            <p role="alert" className="text-sm text-destructive">
              Couldn't list the files: {errorMessage(files.error)}
            </p>
          ) : files.data.files.length === 0 ? (
            <p className="text-sm text-muted-foreground">No files yet.</p>
          ) : (
            <ul className="divide-y" aria-label="Files">
              {byNewest(files.data.files).map((file) => (
                <li
                  key={file.name}
                  className="flex items-center justify-between gap-3 py-2"
                >
                  <div className="min-w-0">
                    <p
                      className="truncate text-sm font-medium"
                      title={file.name}
                    >
                      {file.name}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {formatBytes(file.sizeBytes)} ·{" "}
                      {formatDateTime(file.modifiedAt)}
                    </p>
                  </div>
                  <GatedButton
                    size="sm"
                    variant="outline"
                    gate={printGate}
                    aria-label={`Print ${file.name}`}
                    onClick={() => {
                      print.run({ kind: "print.start", fileName: file.name });
                    }}
                  >
                    Print
                  </GatedButton>
                </li>
              ))}
            </ul>
          ))}
        {listed && online && (
          <GateHint gate={commandGate(state, "print.start")} />
        )}
        <GateHint gate={upload} />
      </CardContent>
    </Card>
  );
}

function UploadButton({
  printerId,
  printerName,
  files,
  gate,
}: {
  printerId: string;
  printerName: string;
  files: NonNullable<PrinterSnapshot["state"]["capabilities"]>["files"];
  gate: Gate;
}) {
  const api = useApi();
  const queryClient = useQueryClient();
  const picker = useRef<HTMLInputElement>(null);
  const uploading = useUploading(printerId);
  const mutation = api.query.useMutation(
    "put",
    "/api/printers/{id}/files/{fileName}",
    {
      onSuccess: (_data, { params }) => {
        toast.success(`Uploaded ${params.path.fileName} to ${printerName}.`);
        void queryClient.invalidateQueries({
          queryKey: filesQuery(api, printerId).queryKey,
        });
      },
      onError: (error, { params }) => {
        toastFailure(`Couldn't upload ${params.path.fileName}`, error);
      },
    },
  );

  function send(file: File): void {
    const problem = uploadProblem(file, files, printerName);
    if (problem !== null) {
      toast.error(`Couldn't upload ${file.name}`, { description: problem });
      return;
    }
    mutation.mutate({
      params: { path: { id: printerId, fileName: file.name } },
      body: file,
      // The file as it is: the browser sends it with its Content-Length.
      bodySerializer: (body) => body,
      headers: { "Content-Type": "application/octet-stream" },
    });
  }

  return (
    <>
      <input
        ref={picker}
        type="file"
        className="sr-only"
        tabIndex={-1}
        aria-label="File to upload"
        accept={acceptAttribute(files)}
        onChange={(event) => {
          const file = event.target.files?.[0];
          // The same file can be picked again next time.
          event.target.value = "";
          if (file !== undefined) send(file);
        }}
      />
      <GatedButton
        size="sm"
        gate={
          uploading && gate.shown
            ? { shown: true, enabled: false, reason: "An upload is running." }
            : gate
        }
        pending={uploading}
        onClick={() => {
          picker.current?.click();
        }}
      >
        {!uploading && <UploadIcon data-icon="inline-start" />}
        {uploading ? "Uploading…" : "Upload"}
      </GatedButton>
    </>
  );
}
