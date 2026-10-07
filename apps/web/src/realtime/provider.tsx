// SPDX-FileCopyrightText: 2026 Open Print Stack contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import type {
  OpsEvent,
  PrinterSnapshot,
  Topic,
} from "@openprintstack/protocol";
import { skipToken, type QueryClient, useQuery } from "@tanstack/react-query";
import {
  createContext,
  type ReactNode,
  use,
  useEffect,
  useEffectEvent,
  useMemo,
  useState,
  useSyncExternalStore,
} from "react";

import {
  type FleetData,
  type LiveEventsData,
  type PrinterData,
  querySink,
  realtimeKeys,
} from "./cache.ts";
import {
  type ConnectionStatus,
  RealtimeClient,
  type RealtimeClientOptions,
} from "./client.ts";

// The page's realtime connection, for the logged-in part of the app. The
// provider connects when it mounts and disconnects when it unmounts; the
// hooks below subscribe their topic while the component using them is
// mounted.

/** What the provider needs to make its client; the app supplies it. */
export type RealtimeSettings = Omit<RealtimeClientOptions, "sink"> & {
  queryClient: QueryClient;
};

const RealtimeContext = createContext<RealtimeClient | null>(null);

export function RealtimeProvider({
  settings,
  children,
}: {
  settings: RealtimeSettings;
  children: ReactNode;
}) {
  const [client] = useState(() => {
    const { queryClient, ...options } = settings;
    return new RealtimeClient({ ...options, sink: querySink(queryClient) });
  });
  useEffect(() => {
    client.start();
    return () => {
      client.stop();
    };
  }, [client]);
  return <RealtimeContext value={client}>{children}</RealtimeContext>;
}

/** The page's realtime client. */
export function useRealtime(): RealtimeClient {
  const client = use(RealtimeContext);
  if (client === null) {
    throw new Error("useRealtime needs a <RealtimeProvider> above it.");
  }
  return client;
}

export function useConnectionStatus(): ConnectionStatus {
  const client = useRealtime();
  return useSyncExternalStore(
    (listener) => client.onStatus(listener),
    () => client.status,
  );
}

/**
 * Subscribes `topic` while the component is mounted. Pass the same object for
 * as long as it means the same topic (a constant, or from useMemo): a new one
 * each render is released and retained again each render.
 */
export function useTopic(topic: Topic): void {
  const client = useRealtime();
  useEffect(() => client.retain(topic), [client, topic]);
}

/**
 * Calls `listener` with each live event while the component is mounted:
 * once per event, from whichever topics in use carry it, after the cache has
 * been updated. Snapshots aren't events, so state already there when a page
 * opens isn't heard. The listener can change between renders (it's an
 * Effect Event).
 */
export function useRealtimeEvents(listener: (event: OpsEvent) => void): void {
  const client = useRealtime();
  const onEvent = useEffectEvent(listener);
  useEffect(
    () =>
      client.onEvent((event) => {
        onEvent(event);
      }),
    [client],
  );
}

/** Every printer's events; the logged-in layout keeps it for event toasts. */
export const FLEET_TOPIC: Topic = { name: "fleet" };

/** Every printer, live and sorted by name; undefined until the snapshot. */
export function useFleet(): PrinterSnapshot[] | undefined {
  useTopic(FLEET_TOPIC);
  return useQuery<FleetData, Error, FleetData>({
    queryKey: realtimeKeys.fleet,
    queryFn: skipToken,
    select: byName,
  }).data;
}

/**
 * One printer, live; null if there's no such printer, undefined until the
 * snapshot.
 */
export function usePrinter(printerId: string): PrinterData | undefined {
  const topic = useMemo<Topic>(
    () => ({ name: "printer", printerId }),
    [printerId],
  );
  useTopic(topic);
  return useQuery<PrinterData>({
    queryKey: realtimeKeys.printer(printerId),
    queryFn: skipToken,
  }).data;
}

/**
 * The event log's live tail: an events topic's events since its snapshot,
 * newest first; undefined until the snapshot, which marks where the tail
 * starts. Pass the same topic object for as long as it means the same topic
 * (useMemo).
 */
export function useLiveEvents(topic: Topic): LiveEventsData | undefined {
  useTopic(topic);
  return useQuery<LiveEventsData>({
    queryKey: realtimeKeys.events(topic),
    queryFn: skipToken,
  }).data;
}

const collator = new Intl.Collator(undefined, { numeric: true });

/** Sorted by name ("Printer 2" before "Printer 10"), then id. */
export function byName(fleet: FleetData): FleetData {
  return fleet.toSorted(
    (a, b) =>
      collator.compare(a.printer.name, b.printer.name) ||
      collator.compare(a.printer.id, b.printer.id),
  );
}
