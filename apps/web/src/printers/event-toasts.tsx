// SPDX-FileCopyrightText: 2026 Open Print Stack contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { JobOutcome, OpsEvent } from "@openprintstack/protocol";
import { useQueryClient } from "@tanstack/react-query";
import { useRef } from "react";
import { toast } from "sonner";

import { type FleetData, realtimeKeys } from "../realtime/cache.ts";
import {
  FLEET_TOPIC,
  useRealtimeEvents,
  useTopic,
} from "../realtime/provider.tsx";

// Toasts for what happens to any printer, on every page behind the login:
//
//   printer.alert            its severity (info, warning, error), with the
//                            printer's message
//   printer.job_ended        finished, cancelled or failed
//   printer.status_changed   into error (with the printer's message), or
//                            offline (with its detail); not the offline that
//                            restarting the driver for new settings causes
//
// Only live events toast: a printer already in error when the page opens
// doesn't. The layout keeps the fleet subscribed, so every printer's events
// arrive whichever page is open.

export type EventToast = {
  kind: "info" | "warning" | "error" | "success";
  title: string;
  description?: string;
};

/**
 * The toast for an event, or null if it doesn't toast. `restarting`: the
 * printer's settings have just changed, so its driver is restarting, and the
 * offline that causes isn't news.
 */
export function eventToast(
  event: OpsEvent,
  name: string,
  restarting = false,
): EventToast | null {
  switch (event.type) {
    case "printer.alert":
      return {
        kind: event.payload.severity,
        title: `Alert from ${name}`,
        description: event.payload.message,
      };
    case "printer.job_ended": {
      const { outcome, fileName } = event.payload;
      return JOB_ENDED[outcome](name, fileName);
    }
    case "printer.status_changed": {
      const { previous, status, detail, error } = event.payload;
      if (status === previous) return null;
      if (status === "error") {
        return withDescription(
          { kind: "error", title: `${name} has an error.` },
          error?.message ?? detail,
        );
      }
      if (status === "offline" && !restarting) {
        return withDescription(
          { kind: "warning", title: `${name} is offline.` },
          detail,
        );
      }
      return null;
    }
    default:
      return null;
  }
}

const JOB_ENDED: Record<
  JobOutcome,
  (name: string, fileName: string) => EventToast
> = {
  completed: (name, fileName) => ({
    kind: "success",
    title: `${name} finished ${fileName}.`,
  }),
  cancelled: (name, fileName) => ({
    kind: "info",
    title: `${name}: ${fileName} was cancelled.`,
  }),
  failed: (name, fileName) => ({
    kind: "error",
    title: `${name}: ${fileName} failed.`,
  }),
};

function withDescription(
  base: EventToast,
  description: string | null,
): EventToast {
  return description === null ? base : { ...base, description };
}

/**
 * The printers restarting after `event`: a settings change restarts the
 * driver, and only the status change that follows it (offline, from the
 * stop) is the restart's. A printer that then fails to reconnect still
 * toasts.
 */
export function restartingAfter(
  restarting: ReadonlySet<string>,
  event: OpsEvent,
): ReadonlySet<string> {
  const { printerId } = event;
  if (printerId === null) return restarting;
  if (
    event.type === "printer.updated" &&
    event.payload.changedFields.includes("settings")
  ) {
    return new Set(restarting).add(printerId);
  }
  if (
    (event.type === "printer.status_changed" ||
      event.type === "printer.removed") &&
    restarting.has(printerId)
  ) {
    const next = new Set(restarting);
    next.delete(printerId);
    return next;
  }
  return restarting;
}

/** Shows the event toasts; rendered once, in the logged-in layout. */
export function EventToasts() {
  useTopic(FLEET_TOPIC);
  const queryClient = useQueryClient();
  const restarting = useRef<ReadonlySet<string>>(new Set());
  useRealtimeEvents((event) => {
    if (event.printerId === null) return;
    const fleet = queryClient.getQueryData<FleetData>(realtimeKeys.fleet);
    const name =
      fleet?.find((entry) => entry.printer.id === event.printerId)?.printer
        .name ?? "A printer";
    const shown = eventToast(
      event,
      name,
      restarting.current.has(event.printerId),
    );
    restarting.current = restartingAfter(restarting.current, event);
    if (shown === null) return;
    const { kind, title, description } = shown;
    toast[kind](title, description === undefined ? {} : { description });
  });
  return null;
}
