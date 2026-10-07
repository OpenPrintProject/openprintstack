// SPDX-FileCopyrightText: 2026 Open Print Stack contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import type {
  OpsEvent,
  PrinterCommand,
  PrinterSnapshot,
  SessionUser,
} from "@openprintstack/protocol";
import { useInfiniteQuery } from "@tanstack/react-query";
import { useMemo } from "react";

import { errorMessage } from "../api/errors.ts";
import { Badge } from "../components/ui/badge.tsx";
import { Button } from "../components/ui/button.tsx";
import { Label } from "../components/ui/label.tsx";
import {
  NativeSelect,
  NativeSelectOption,
} from "../components/ui/native-select.tsx";
import { Spinner } from "../components/ui/spinner.tsx";
import { Switch } from "../components/ui/switch.tsx";
import { useApi } from "../printers/api.ts";
import { formatDateTimeSeconds } from "../printers/format.ts";
import { useFleet, useLiveEvents } from "../realtime/provider.tsx";
import { type EventPage, eventLogQuery } from "./api.ts";
import {
  CATEGORY_LABEL,
  eventSummary,
  type LogContext,
  sourceText,
  TYPE_LABEL,
} from "./describe.ts";
import { type EventFilters, liveTopic } from "./filters.ts";
import { TypeFilter } from "./type-filter.tsx";

// The event log: stored events, newest first, a page at a time, with new
// ones added live at the top.
//
//   the tail   the events topic for the filters (useLiveEvents): events since
//              its snapshot. The first page waits for that snapshot, so no
//              event falls between the two
//   the pages  GET /api/events, 100 at a time; "Load older events" fetches
//              the next. A tail event is dropped once a page holds it (after
//              a reconnect refetches them: realtime/cache.ts)
//
// Printer names come from the fleet, or for a deleted printer from its
// printer.removed event if that's loaded; usernames from the pages' users and
// the logged-in user; a command result names its command from its request.

export function EventLogPage({
  filters,
  onFiltersChange,
  sessionUser,
}: {
  filters: EventFilters;
  onFiltersChange: (filters: EventFilters) => void;
  sessionUser: SessionUser;
}) {
  const api = useApi();
  const fleet = useFleet();
  const topic = useMemo(() => liveTopic(filters), [filters]);
  const live = useLiveEvents(topic);
  const log = useInfiniteQuery({
    ...eventLogQuery(api, filters),
    enabled: live !== undefined,
  });
  const pages = log.data?.pages;
  const events = useMemo(() => logEvents(live, pages), [live, pages]);
  const names = useMemo(
    () => logNames(fleet, events, pages, sessionUser),
    [fleet, events, pages, sessionUser],
  );

  return (
    <section aria-labelledby="event-log" className="flex flex-col gap-4">
      <h1 id="event-log" className="font-heading text-xl font-semibold">
        Event log
      </h1>
      <Filters
        filters={filters}
        onChange={onFiltersChange}
        fleet={fleet}
        names={names}
      />
      {pages === undefined || fleet === undefined ? (
        log.isError ? (
          <div className="flex flex-col items-start gap-2">
            <p role="alert" className="text-sm text-destructive">
              Couldn't load the events: {errorMessage(log.error)}
            </p>
            <Button
              variant="outline"
              onClick={() => {
                void log.refetch();
              }}
            >
              Try again
            </Button>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">Loading events…</p>
        )
      ) : events.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {isFiltered(filters)
            ? "No events match these filters."
            : "No events yet."}
        </p>
      ) : (
        <>
          {log.isRefetchError && (
            <p role="alert" className="text-sm text-destructive">
              Couldn't refresh the events: {errorMessage(log.error)}
            </p>
          )}
          <ol aria-label="Events" className="flex flex-col">
            {events.map((event) => (
              <EventRow key={event.id} event={event} names={names} />
            ))}
          </ol>
          <div className="flex flex-col items-start gap-2">
            {log.isFetchNextPageError && (
              <p role="alert" className="text-sm text-destructive">
                Couldn't load older events: {errorMessage(log.error)}
              </p>
            )}
            {log.hasNextPage ? (
              <Button
                variant="outline"
                disabled={log.isFetchingNextPage}
                onClick={() => {
                  void log.fetchNextPage();
                }}
              >
                {log.isFetchingNextPage && (
                  <Spinner data-icon="inline-start" aria-hidden />
                )}
                Load older events
              </Button>
            ) : (
              <p className="text-sm text-muted-foreground">
                That's the oldest event.
              </p>
            )}
          </div>
        </>
      )}
    </section>
  );
}

function Filters({
  filters,
  onChange,
  fleet,
  names,
}: {
  filters: EventFilters;
  onChange: (filters: EventFilters) => void;
  fleet: PrinterSnapshot[] | undefined;
  names: LogNames;
}) {
  const { printerId } = filters;
  const listed =
    printerId === undefined ||
    fleet?.some((snapshot) => snapshot.printer.id === printerId) === true;
  return (
    <div className="flex flex-wrap items-end gap-x-4 gap-y-3">
      <div className="flex flex-col gap-2">
        <Label htmlFor="event-log-printer">Printer</Label>
        <NativeSelect
          id="event-log-printer"
          value={printerId ?? ""}
          onChange={(event) => {
            const value = event.target.value;
            onChange({
              ...filters,
              printerId: value === "" ? undefined : value,
            });
          }}
        >
          <NativeSelectOption value="">All printers</NativeSelectOption>
          {fleet?.map(({ printer }) => (
            <NativeSelectOption key={printer.id} value={printer.id}>
              {printer.name}
            </NativeSelectOption>
          ))}
          {/* A deleted printer's history is kept, so an old link still works. */}
          {!listed && (
            <NativeSelectOption value={printerId}>
              {fleet === undefined ? "Loading…" : names.printer(printerId).name}
            </NativeSelectOption>
          )}
        </NativeSelect>
      </div>
      <div className="flex flex-col gap-2">
        <span className="text-sm leading-none font-medium">Types</span>
        <TypeFilter
          types={filters.types}
          onChange={(types) => {
            onChange({ ...filters, types });
          }}
        />
      </div>
      <div className="flex flex-col gap-1">
        <div className="flex h-8 items-center gap-2">
          <Switch
            id="event-log-telemetry"
            checked={filters.telemetry}
            onCheckedChange={(telemetry) => {
              onChange({ ...filters, telemetry });
            }}
          />
          <Label htmlFor="event-log-telemetry">Include telemetry</Label>
        </div>
      </div>
      {filters.telemetry && (
        <p className="w-full text-sm text-muted-foreground">
          New telemetry appears when you reload.
        </p>
      )}
    </div>
  );
}

function EventRow({ event, names }: { event: OpsEvent; names: LogNames }) {
  const summary = eventSummary(event, names);
  const printer =
    event.printerId === null ? null : names.printer(event.printerId);
  return (
    <li className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 border-b py-3 first:pt-0 sm:grid-cols-[11rem_9rem_1fr_7rem]">
      <time
        dateTime={event.ts}
        title={event.ts}
        className="text-sm text-muted-foreground tabular-nums"
      >
        {formatDateTimeSeconds(event.ts)}
      </time>
      <span
        className="truncate text-sm"
        title={printer?.deleted === true ? (event.printerId ?? "") : undefined}
      >
        {printer?.name ?? "—"}
      </span>
      <div className="col-span-2 flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-1 text-sm sm:col-span-1">
        <span className="font-medium">{TYPE_LABEL[event.type]}</span>
        {summary !== null && <span className="break-words">{summary}</span>}
        <Badge variant="outline">{CATEGORY_LABEL[event.category]}</Badge>
      </div>
      <span className="col-span-2 truncate text-sm text-muted-foreground sm:col-span-1">
        {sourceText(event.source, names.users)}
      </span>
      <details className="col-span-2 text-sm sm:col-span-4">
        <summary className="w-fit cursor-pointer text-muted-foreground hover:text-foreground">
          Details
        </summary>
        <pre className="mt-2 overflow-x-auto rounded-md bg-muted p-3 text-xs">
          {JSON.stringify(event, null, 2)}
        </pre>
      </details>
    </li>
  );
}

/** The tail's events a page doesn't hold yet, then the pages' events. */
function logEvents(
  live: readonly OpsEvent[] | undefined,
  pages: readonly EventPage[] | undefined,
): OpsEvent[] {
  if (pages === undefined) return [];
  const stored: OpsEvent[] = pages.flatMap((page) => page.events);
  const ids = new Set(stored.map((event) => event.id));
  return [...(live ?? []).filter((event) => !ids.has(event.id)), ...stored];
}

type LogNames = LogContext & {
  printer(printerId: string): { name: string; deleted: boolean };
  users: ReadonlyMap<string, string>;
};

/** What the rows' ids refer to, from what the page has loaded. */
function logNames(
  fleet: PrinterSnapshot[] | undefined,
  events: readonly OpsEvent[],
  pages: readonly EventPage[] | undefined,
  sessionUser: SessionUser,
): LogNames {
  const printers = new Map(
    (fleet ?? []).map((snapshot) => [snapshot.printer.id, snapshot]),
  );
  const removed = new Map<string, string>();
  const requests = new Map<string, PrinterCommand>();
  for (const event of events) {
    if (event.type === "printer.removed" && !removed.has(event.printerId)) {
      removed.set(event.printerId, event.payload.name);
    } else if (event.type === "command.requested") {
      requests.set(event.payload.commandId, event.payload.command);
    }
  }
  const users = new Map<string, string>([
    [sessionUser.id, sessionUser.username],
  ]);
  for (const page of pages ?? []) {
    for (const [id, username] of Object.entries(page.users)) {
      users.set(id, username);
    }
  }
  return {
    printer(printerId) {
      const snapshot = printers.get(printerId);
      if (snapshot !== undefined) {
        return { name: snapshot.printer.name, deleted: false };
      }
      const name = removed.get(printerId);
      return {
        name: name === undefined ? "Deleted printer" : `${name} (deleted)`,
        deleted: true,
      };
    },
    partLabel(printerId, part, id) {
      const capabilities = printers.get(printerId)?.state.capabilities;
      return capabilities?.[part].find((each) => each.id === id)?.label;
    },
    request: (commandId) => requests.get(commandId),
    users,
  };
}

function isFiltered(filters: EventFilters): boolean {
  return filters.printerId !== undefined || filters.types.length > 0;
}
