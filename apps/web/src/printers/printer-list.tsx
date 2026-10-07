// SPDX-FileCopyrightText: 2026 Open Print Stack contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { PrinterSnapshot } from "@openprintstack/protocol";
import { Link } from "@tanstack/react-router";
import { PlusIcon } from "lucide-react";

import { Button } from "../components/ui/button.tsx";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "../components/ui/card.tsx";
import { useFleet } from "../realtime/provider.tsx";
import {
  JobProgressBar,
  PrinterStatusBadge,
  summaryHeaters,
  temperatureText,
} from "./parts.tsx";

// The home page: every printer, live, sorted by name. Each card shows the
// status, the job's progress, and the nozzle and bed temperatures, and opens
// the printer's page.

export function PrinterList() {
  const fleet = useFleet();
  return (
    <section aria-labelledby="printers" className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 id="printers" className="font-heading text-xl font-semibold">
          Printers
        </h1>
        <Button asChild>
          <Link to="/printers/new">
            <PlusIcon data-icon="inline-start" />
            Add printer
          </Link>
        </Button>
      </div>
      {fleet === undefined ? (
        <p className="text-sm text-muted-foreground">Loading printers…</p>
      ) : fleet.length === 0 ? (
        <p className="text-sm text-muted-foreground">No printers yet.</p>
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {fleet.map((snapshot) => (
            <li key={snapshot.printer.id}>
              <PrinterCard snapshot={snapshot} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function PrinterCard({ snapshot }: { snapshot: PrinterSnapshot }) {
  const { printer, state } = snapshot;
  const { job, temperatures } = state.telemetry;
  const heaters = summaryHeaters(state);
  return (
    <Card className="relative h-full transition-colors has-[a:hover]:bg-muted/50">
      <CardHeader>
        <CardTitle>
          <h2>
            {/* The link covers the card, so the whole card opens it. */}
            <Link
              to="/printers/$printerId"
              params={{ printerId: printer.id }}
              className="after:absolute after:inset-0"
            >
              {printer.name}
            </Link>
          </h2>
        </CardTitle>
        <PrinterStatusBadge state={state} />
      </CardHeader>
      {(job !== null || heaters.length > 0) && (
        <CardContent className="flex flex-col gap-3">
          {job !== null && <JobProgressBar job={job} />}
          {heaters.length > 0 && (
            <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
              {heaters.map((heater) => (
                <div key={heater.id} className="contents">
                  <dt className="text-muted-foreground">{heater.label}</dt>
                  <dd className="tabular-nums">
                    {temperatureText(temperatures[heater.id])}
                  </dd>
                </div>
              ))}
            </dl>
          )}
        </CardContent>
      )}
    </Card>
  );
}
