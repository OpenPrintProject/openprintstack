// SPDX-FileCopyrightText: 2026 Open Print Stack contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { Link } from "@tanstack/react-router";
import { ArrowLeftIcon, PencilIcon } from "lucide-react";
import { useState, type ReactNode } from "react";

import { Button } from "../components/ui/button.tsx";
import { usePrinter } from "../realtime/provider.tsx";
import { CameraCard } from "./detail/camera-card.tsx";
import { DeletePrinter } from "./detail/delete-printer.tsx";
import { FansCard } from "./detail/fans-card.tsx";
import { FilesCard } from "./detail/files-card.tsx";
import { MotionCard } from "./detail/motion-card.tsx";
import { PrintCard } from "./detail/print-card.tsx";
import { SimulatorCard } from "./detail/simulator-card.tsx";
import { TemperaturesCard } from "./detail/temperatures-card.tsx";
import { PrinterStatusBadge } from "./parts.tsx";

// One printer, live: its status, then a card for each thing it can do. Each
// card hides itself when the printer's capabilities don't include it.

export function PrinterPage({ printerId }: { printerId: string }) {
  const snapshot = usePrinter(printerId);
  // Remembered, so a printer deleted while it's open can be named.
  const [lastName, setLastName] = useState<string>();
  if (snapshot != null && snapshot.printer.name !== lastName) {
    setLastName(snapshot.printer.name);
  }

  if (snapshot === undefined) {
    return (
      <PageFrame>
        <p className="text-sm text-muted-foreground">Loading the printer…</p>
      </PageFrame>
    );
  }
  if (snapshot === null) {
    return (
      <PageFrame>
        <h1 className="font-heading text-xl font-semibold">
          {lastName === undefined ? "No such printer" : `${lastName} is gone`}
        </h1>
        <p className="text-sm text-muted-foreground">
          {lastName === undefined
            ? "There's no printer at this address. It may have been deleted."
            : "It has been deleted."}
        </p>
      </PageFrame>
    );
  }

  const { printer, state } = snapshot;
  return (
    <PageFrame>
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-2">
          <h1 className="font-heading text-xl font-semibold">{printer.name}</h1>
          <PrinterStatusBadge state={state} />
        </div>
        <div className="flex gap-2">
          <Button variant="outline" asChild>
            <Link to="/printers/$printerId/edit" params={{ printerId }}>
              <PencilIcon data-icon="inline-start" />
              Edit
            </Link>
          </Button>
          <DeletePrinter snapshot={snapshot} />
        </div>
      </header>
      {state.capabilities === null && (
        <p className="text-sm text-muted-foreground">
          Waiting for the printer to say what it can do.
        </p>
      )}
      <div className="grid items-start gap-4 md:grid-cols-2">
        <PrintCard snapshot={snapshot} />
        <TemperaturesCard snapshot={snapshot} />
        <FilesCard snapshot={snapshot} />
        <MotionCard snapshot={snapshot} />
        <FansCard snapshot={snapshot} />
        <CameraCard snapshot={snapshot} />
        <SimulatorCard snapshot={snapshot} />
      </div>
    </PageFrame>
  );
}

/** The back link and the page. */
export function PageFrame({ children }: { children: ReactNode }) {
  return (
    <section className="flex flex-col gap-4">
      <Link
        to="/"
        className="flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeftIcon className="size-4" aria-hidden />
        Printers
      </Link>
      {children}
    </section>
  );
}
