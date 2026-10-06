// SPDX-FileCopyrightText: 2026 Open Print Stack contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  initialPrinterState,
  type OpsEvent,
  type PrinterSnapshot,
  reducePrinterState,
  type Topic,
  type WsSnapshotOf,
} from "@openprintstack/protocol";
import type { QueryClient } from "@tanstack/react-query";

import type { RealtimeSink, SnapshotMessage } from "./client.ts";

// Live printer state in the TanStack Query cache, under keys only the
// realtime client writes:
//
//   ["realtime", "fleet"]             every printer (PrinterSnapshot[], in the
//                                     server's order; useFleet sorts it)
//   ["realtime", "printer", <id>]     one printer, or null if there's no such
//                                     printer (refused, or removed)
//
// Snapshots replace the data; events are applied with protocol's
// reducePrinterState, mirroring the server's state store:
//
//   printer.added    a new entry, as the store makes it (name and driver type
//                    are in the payload)
//   printer.removed  the entry goes
//   printer.updated  with "name": a fresh snapshot (the event doesn't say the
//                    new name, and the store looks it up)
//   an unknown printer: a fresh snapshot
//
// The events topic (the event log's live tail) has no cache yet: PR 12 adds
// it.

export const realtimeKeys = {
  all: ["realtime"],
  fleet: ["realtime", "fleet"],
  printer: (printerId: string) => ["realtime", "printer", printerId],
} as const;

export type FleetData = PrinterSnapshot[];

/** Null: the server has no such printer. */
export type PrinterData = PrinterSnapshot | null;

/** The fleet after `event`, or "resync" if it can't be worked out. */
export function applyToFleet(
  fleet: FleetData,
  event: OpsEvent,
): FleetData | "resync" {
  const { printerId } = event;
  if (printerId === null) return fleet;
  const index = fleet.findIndex((entry) => entry.printer.id === printerId);
  if (index === -1) {
    if (event.type === "printer.removed") return fleet;
    if (event.type !== "printer.added") return "resync";
    return [...fleet, addedPrinter(event)];
  }
  if (event.type === "printer.removed") {
    return fleet.filter((_, i) => i !== index);
  }
  const entry = applyToPrinter(fleet[index] ?? null, event);
  return entry === "resync" || entry === null
    ? "resync"
    : fleet.with(index, entry);
}

/** One printer after `event`, or "resync" if it can't be worked out. */
export function applyToPrinter(
  current: PrinterData,
  event: OpsEvent,
): PrinterData | "resync" {
  if (current === null || event.printerId !== current.printer.id) {
    return current;
  }
  if (event.type === "printer.removed") return null;
  if (
    event.type === "printer.updated" &&
    event.payload.changedFields.includes("name")
  ) {
    return "resync";
  }
  return {
    ...current,
    state: reducePrinterState(current.state, event),
    seq: event.seq,
  };
}

function addedPrinter(
  event: Extract<OpsEvent, { type: "printer.added" }>,
): PrinterSnapshot {
  return {
    printer: {
      id: event.printerId,
      name: event.payload.name,
      driverType: event.payload.driverType,
    },
    state: reducePrinterState(initialPrinterState(event.ts), event),
    seq: event.seq,
  };
}

/** The sink that keeps the realtime keys up to date. */
export function querySink(queryClient: QueryClient): RealtimeSink {
  return {
    snapshot(message) {
      if (isSnapshotOf(message, "fleet")) {
        queryClient.setQueryData<FleetData>(realtimeKeys.fleet, message.data);
      } else if (isSnapshotOf(message, "printer")) {
        queryClient.setQueryData<PrinterData>(
          realtimeKeys.printer(message.topic.printerId),
          message.data,
        );
      }
    },
    event(topic, event) {
      switch (topic.name) {
        case "fleet":
          return update<FleetData>(queryClient, realtimeKeys.fleet, (fleet) =>
            applyToFleet(fleet, event),
          );
        case "printer":
          return update<PrinterData>(
            queryClient,
            realtimeKeys.printer(topic.printerId),
            (printer) => applyToPrinter(printer, event),
          );
        case "events":
          return "applied";
      }
    },
    refused(topic, code) {
      if (topic.name === "printer" && code === "printer_not_found") {
        queryClient.setQueryData<PrinterData>(
          realtimeKeys.printer(topic.printerId),
          null,
        );
      }
    },
    dropped(topic) {
      if (topic.name === "fleet") {
        queryClient.removeQueries({
          queryKey: realtimeKeys.fleet,
          exact: true,
        });
      } else if (topic.name === "printer") {
        queryClient.removeQueries({
          queryKey: realtimeKeys.printer(topic.printerId),
          exact: true,
        });
      }
    },
    reset() {
      // Reset, not removed: components on screen keep watching the same
      // queries, and see them empty until the fresh snapshots arrive.
      void queryClient.resetQueries({ queryKey: realtimeKeys.all });
      // Everything fetched over REST may be out of date too.
      void queryClient.invalidateQueries({
        predicate: (query) => query.queryKey[0] !== realtimeKeys.all[0],
      });
    },
  };
}

/**
 * Narrows a snapshot by its topic, which TypeScript can't do by itself from
 * the nested `topic.name`.
 */
function isSnapshotOf<N extends Topic["name"]>(
  message: SnapshotMessage,
  name: N,
): message is WsSnapshotOf<N> {
  return message.topic.name === name;
}

/** Applies `change` to the cached data; "resync" if there's none. */
function update<T>(
  queryClient: QueryClient,
  queryKey: readonly unknown[],
  change: (data: T) => T | "resync",
): "applied" | "resync" {
  const data = queryClient.getQueryData<T>(queryKey);
  if (data === undefined) return "resync";
  const next = change(data);
  if (next === "resync") return "resync";
  if (next !== data) queryClient.setQueryData<T>(queryKey, next);
  return "applied";
}
