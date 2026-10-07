// SPDX-FileCopyrightText: 2026 Open Print Stack contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  initialPrinterState,
  type OpsEvent,
  type PrinterSnapshot,
  reducePrinterState,
  type Topic,
  topicKey,
  type WsSnapshotOf,
} from "@openprintstack/protocol";
import type { QueryClient } from "@tanstack/react-query";

import type { RealtimeSink, SnapshotMessage } from "./client.ts";

// Live data in the TanStack Query cache, under keys only the realtime client
// writes:
//
//   ["realtime", "fleet"]             every printer (PrinterSnapshot[], in the
//                                     server's order; useFleet sorts it)
//   ["realtime", "printer", <id>]     one printer, or null if there's no such
//                                     printer (refused, or removed)
//   ["realtime", "events", <key>]     the event log's live tail: an events
//                                     topic's events since its first
//                                     snapshot, newest first (key: topicKey)
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
// An events topic's snapshot carries no data: it marks where the tail
// starts, so the first one sets an empty list. A later one (after a
// reconnect, a resync or a server restart) means events may have been missed
// in between: the tail keeps what it has, and the event log's pages are
// refetched over REST, where every event in the tail is stored, to fill the
// gap. The page drops a tail event once a page holds it.

export const realtimeKeys = {
  all: ["realtime"],
  fleet: ["realtime", "fleet"],
  printer: (printerId: string) => ["realtime", "printer", printerId],
  events: (topic: Topic) => ["realtime", "events", topicKey(topic)],
} as const;

/**
 * Where the event log's REST pages are kept (events/api.ts keeps each
 * filtered log under it): an events topic's later snapshot refetches them.
 */
export const EVENT_LOG_KEY = ["events"] as const;

export type FleetData = PrinterSnapshot[];

/** Null: the server has no such printer. */
export type PrinterData = PrinterSnapshot | null;

/** An events topic's events since its first snapshot, newest first. */
export type LiveEventsData = OpsEvent[];

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
      } else if (isSnapshotOf(message, "events")) {
        const key = realtimeKeys.events(message.topic);
        if (queryClient.getQueryData<LiveEventsData>(key) === undefined) {
          queryClient.setQueryData<LiveEventsData>(key, []);
        } else {
          void queryClient.invalidateQueries({ queryKey: EVENT_LOG_KEY });
        }
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
          return update<LiveEventsData>(
            queryClient,
            realtimeKeys.events(topic),
            (events) => [event, ...events],
          );
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
      queryClient.removeQueries({ queryKey: queryKeyOf(topic), exact: true });
    },
    reset() {
      // Reset, not removed: components on screen keep watching the same
      // queries, and see them empty until the fresh snapshots arrive. The
      // event log's tail is kept: its events still happened, and its fresh
      // snapshot refetches the log's pages (see the top of the file).
      void queryClient.resetQueries({
        queryKey: realtimeKeys.all,
        predicate: (query) => query.queryKey[1] !== "events",
      });
      // Everything fetched over REST may be out of date too.
      void queryClient.invalidateQueries({
        predicate: (query) => query.queryKey[0] !== realtimeKeys.all[0],
      });
    },
  };
}

/** Where a topic's data is kept. */
function queryKeyOf(topic: Topic): readonly unknown[] {
  switch (topic.name) {
    case "fleet":
      return realtimeKeys.fleet;
    case "printer":
      return realtimeKeys.printer(topic.printerId);
    case "events":
      return realtimeKeys.events(topic);
  }
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
