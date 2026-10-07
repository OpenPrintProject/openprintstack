// SPDX-FileCopyrightText: 2026 Open Print Stack contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { rootRouteId, useRouteContext } from "@tanstack/react-router";
import {
  type Mutation,
  useIsMutating,
  useQueryClient,
} from "@tanstack/react-query";
import { toast } from "sonner";

import type { Api } from "../api/client.ts";
import { signedOutReason } from "../api/client.ts";
import { errorMessage } from "../api/errors.ts";
import type { components } from "../api/schema.gen.ts";

// The printers' REST side: the driver types, a printer's stored config, its
// files and cameras, and the mutations that run its commands. Live state
// comes from the realtime hooks instead (usePrinter, useFleet).
//
// The server takes one command at a time per printer (409 printer_busy),
// simulator actions included, as they are commands too; uploads have a lane
// of their own. So while one of a printer's commands is waiting for its
// answer, its other controls are locked (`useCommandLock`).

export type UserCommand = components["schemas"]["UserCommand"];
export type DriverType = components["schemas"]["DriverType"];
export type PrinterConfig = components["schemas"]["PrinterConfig"];

/** The app's API client, from the router's context. */
export function useApi(): Api {
  return useRouteContext({
    from: rootRouteId,
    select: (context) => context.api,
  });
}

export function driverTypesQuery(api: Api) {
  // The driver types only change with the server's version; a restart
  // (a new bootId) refetches every REST answer anyway.
  return api.query.queryOptions("get", "/api/driver-types", undefined, {
    staleTime: Infinity,
  });
}

export function configQuery(api: Api, printerId: string) {
  return api.query.queryOptions("get", "/api/printers/{id}/config", {
    params: { path: { id: printerId } },
  });
}

export function filesQuery(api: Api, printerId: string) {
  return api.query.queryOptions("get", "/api/printers/{id}/files", {
    params: { path: { id: printerId } },
  });
}

export function camerasQuery(api: Api, printerId: string) {
  return api.query.queryOptions("get", "/api/printers/{id}/cameras", {
    params: { path: { id: printerId } },
  });
}

/** A snapshot's address; `version` changes to make the browser ask again. */
export function snapshotUrl(
  printerId: string,
  cameraId: string,
  version: number,
): string {
  const id = encodeURIComponent(printerId);
  const camera = encodeURIComponent(cameraId);
  return `/api/printers/${id}/cameras/${camera}/snapshot?t=${version}`;
}

const COMMANDS = "/api/printers/{id}/commands";
const SIMULATOR = "/api/printers/{id}/simulator/";
const UPLOAD = "/api/printers/{id}/files/{fileName}";

/** The printer a mutation's request is for, if it names one. */
function printerOf(mutation: Mutation): unknown {
  const variables = mutation.state.variables as
    { params?: { path?: { id?: unknown } } } | undefined;
  return variables?.params?.path?.id;
}

/** Whether a mutation is one of the printer's commands (simulator's too). */
export function isCommandOf(mutation: Mutation, printerId: string): boolean {
  const [method, path] = mutation.options.mutationKey ?? [];
  return (
    method === "post" &&
    typeof path === "string" &&
    (path === COMMANDS || path.startsWith(SIMULATOR)) &&
    printerOf(mutation) === printerId
  );
}

/** Whether a mutation is an upload to the printer. */
export function isUploadTo(mutation: Mutation, printerId: string): boolean {
  const [method, path] = mutation.options.mutationKey ?? [];
  return (
    method === "put" && path === UPLOAD && printerOf(mutation) === printerId
  );
}

/** Whether one of the printer's commands is waiting for its answer. */
export function useCommandLock(printerId: string): boolean {
  return (
    useIsMutating({
      predicate: (mutation) => isCommandOf(mutation, printerId),
    }) > 0
  );
}

/** Whether an upload to the printer is running. */
export function useUploading(printerId: string): boolean {
  return (
    useIsMutating({
      predicate: (mutation) => isUploadTo(mutation, printerId),
    }) > 0
  );
}

/**
 * Runs commands on one printer. `failure` names what failed, for the toast
 * that shows the server's reason. `run` does nothing while another of the
 * printer's commands is running (a second click before the page re-renders).
 */
export function useCommand(
  printerId: string,
  failure: (command: UserCommand) => string,
) {
  const api = useApi();
  const queryClient = useQueryClient();
  const mutation = api.query.useMutation("post", COMMANDS, {
    onError: (error, { body }) => {
      toastFailure(failure(body), error);
    },
  });
  return {
    run(command: UserCommand): void {
      const busy = queryClient.isMutating({
        predicate: (each) => isCommandOf(each, printerId),
      });
      if (busy > 0) return;
      mutation.mutate({ params: { path: { id: printerId } }, body: command });
    },
    isPending: mutation.isPending,
  };
}

/**
 * Shows that something failed, with the server's reason. A failure that
 * means the session has gone shows nothing: the page is going to /login.
 */
export function toastFailure(title: string, error: unknown): void {
  if (signedOutReason(error) !== undefined) return;
  toast.error(title, { description: errorMessage(error) });
}
