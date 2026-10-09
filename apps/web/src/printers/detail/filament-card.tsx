// SPDX-FileCopyrightText: 2026 Open Print Stack contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  type FilamentSlot,
  type FilamentSlotStatus,
  isOnline,
  type PrinterSnapshot,
} from "@openprintstack/protocol";

import { Badge } from "../../components/ui/badge.tsx";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "../../components/ui/card.tsx";
import { NOT_REPORTED } from "../format.ts";
import { nozzleRange, SLOT_STATUS_LABEL, slotContents } from "../filament.ts";

// The printer's filament units (a CANVAS, an AMS, a spool holder) and each
// one's slots, read-only: colour, material and name, nozzle range and status.
// Hidden when the printer doesn't report filament. The server keeps the last
// readout while the printer is offline, so the card says when it's that.

export function FilamentCard({ snapshot }: { snapshot: PrinterSnapshot }) {
  const { filament, status } = snapshot.state;
  if (filament === null) return null;
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2>Filament</h2>
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {!isOnline(status) && (
          <p className="text-sm text-muted-foreground">
            Last reported before the printer disconnected.
          </p>
        )}
        {filament.units.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No filament units attached.
          </p>
        ) : (
          filament.units.map((unit) => (
            <section
              key={unit.id}
              aria-label={unit.label}
              className="flex flex-col gap-2"
            >
              <h3 className="text-sm font-medium">{unit.label}</h3>
              <ul className="flex flex-col gap-2">
                {unit.slots.map((slot) => (
                  <SlotRow key={slot.id} slot={slot} />
                ))}
              </ul>
            </section>
          ))
        )}
      </CardContent>
    </Card>
  );
}

const BADGE_VARIANT = {
  active: "default",
  loaded: "secondary",
  empty: "outline",
} as const satisfies Record<FilamentSlotStatus, string>;

function SlotRow({ slot }: { slot: FilamentSlot }) {
  const contents = slotContents(slot);
  const range = nozzleRange(slot);
  return (
    <li className="flex items-center gap-2 text-sm">
      <Swatch colorHex={slot.colorHex} />
      <span className="shrink-0 font-medium">{slot.label}</span>
      <span className="min-w-0 flex-1 truncate text-muted-foreground">
        {contents !== ""
          ? contents
          : slot.status === "empty"
            ? "Empty"
            : NOT_REPORTED}
      </span>
      {range !== null && (
        <span className="shrink-0 text-muted-foreground tabular-nums">
          {range}
        </span>
      )}
      <Badge variant={BADGE_VARIANT[slot.status]}>
        {SLOT_STATUS_LABEL[slot.status]}
      </Badge>
    </li>
  );
}

/** The filament's colour, or a dashed outline when it isn't reported. */
function Swatch({ colorHex }: { colorHex: string | null }) {
  return colorHex === null ? (
    <span
      className="size-4 shrink-0 rounded-sm border border-dashed border-muted-foreground/60"
      aria-hidden
    />
  ) : (
    <span
      className="size-4 shrink-0 rounded-sm border border-muted-foreground/60"
      style={{ backgroundColor: colorHex }}
      title={colorHex}
      aria-hidden
    />
  );
}
