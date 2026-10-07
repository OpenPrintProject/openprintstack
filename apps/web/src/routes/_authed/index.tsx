// SPDX-FileCopyrightText: 2026 Open Print Stack contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { createFileRoute } from "@tanstack/react-router";

import { Badge } from "../../components/ui/badge.tsx";
import { STATUS_LABEL } from "../../printers/status.ts";
import { useFleet } from "../../realtime/provider.tsx";

// The home page: every printer and its live status. A plain list for now;
// the printers pages replace it.

export const Route = createFileRoute("/_authed/")({
  component: FleetPage,
});

function FleetPage() {
  const fleet = useFleet();
  return (
    <section aria-labelledby="printers" className="flex flex-col gap-4">
      <h1 id="printers" className="font-heading text-xl font-semibold">
        Printers
      </h1>
      {fleet === undefined ? (
        <p className="text-sm text-muted-foreground">Loading printers…</p>
      ) : fleet.length === 0 ? (
        <p className="text-sm text-muted-foreground">No printers yet.</p>
      ) : (
        <ul className="divide-y rounded-lg border">
          {fleet.map(({ printer, state }) => (
            <li
              key={printer.id}
              className="flex items-center justify-between gap-4 p-3"
            >
              <span>{printer.name}</span>
              <Badge
                variant={state.status === "error" ? "destructive" : "secondary"}
              >
                {STATUS_LABEL[state.status]}
              </Badge>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
