// SPDX-FileCopyrightText: 2026 Open Print Stack contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import type {
  Capabilities,
  ErrorInfo,
  Filament,
  PrinterSnapshot,
  PrinterStatus,
  Telemetry,
} from "@openprintstack/protocol";
import { capabilitiesFixture, TS } from "@openprintstack/protocol/fixtures";
import { screen, within } from "@testing-library/react";

import { FakeServer } from "./fake-server.ts";

// Printers for the app's tests: a simulated-looking printer, idle and homed,
// with every capability (protocol's fixture: a nozzle up to 300 °C and a bed
// up to 120 °C, a part-cooling fan, .gcode files, a camera and the simulator
// extension), and no filament readout.

export const PRINTER_ID = "p1";

export const IDLE_TELEMETRY: Telemetry = {
  temperatures: {
    nozzle: { actualC: 24.5, targetC: 0 },
    bed: { actualC: 23.9, targetC: 0 },
  },
  fans: { part: { percent: 0 } },
  speedPercent: 100,
  position: { x: 0, y: 0, z: 0 },
  homedAxes: ["x", "y", "z"],
  job: null,
};

export type SnapshotChanges = {
  id?: string;
  name?: string;
  status?: PrinterStatus;
  statusDetail?: string | null;
  error?: ErrorInfo | null;
  telemetry?: Partial<Telemetry>;
  capabilities?: Capabilities | null;
  filament?: Filament | null;
  seq?: number;
};

export function snapshotOf(changes: SnapshotChanges = {}): PrinterSnapshot {
  return {
    printer: {
      id: changes.id ?? PRINTER_ID,
      name: changes.name ?? "Sim 1",
      driverType: "simulated",
    },
    state: {
      status: changes.status ?? "idle",
      statusDetail: changes.statusDetail ?? null,
      error: changes.error ?? null,
      telemetry: { ...IDLE_TELEMETRY, ...changes.telemetry },
      capabilities:
        changes.capabilities === undefined
          ? capabilitiesFixture
          : changes.capabilities,
      filament: changes.filament ?? null,
      updatedAt: TS,
    },
    seq: changes.seq ?? 42,
  };
}

/** The capabilities, with some commands taken out. */
export function without(...kinds: Capabilities["commands"]): Capabilities {
  return {
    ...capabilitiesFixture,
    commands: capabilitiesFixture.commands.filter(
      (kind) => !kinds.includes(kind),
    ),
  };
}

/** A logged-in server with one printer. */
export function serverWith(changes: SnapshotChanges = {}): FakeServer {
  const server = FakeServer.withUser({ loggedIn: true });
  server.addPrinter(snapshotOf(changes));
  return server;
}

/** The card with this heading. */
export function card(name: string): HTMLElement {
  const title = screen.getByRole("heading", { name, level: 2 });
  const found = title.closest<HTMLElement>("[data-slot=card]");
  if (found === null) throw new Error(`The ${name} heading isn't in a card.`);
  return found;
}

/** A button in the card with this heading. */
export function buttonIn(cardName: string, name: string | RegExp): HTMLElement {
  return within(card(cardName)).getByRole("button", { name });
}

/** Whether a button can be pressed. */
export function enabled(button: HTMLElement): boolean {
  return !(button as HTMLButtonElement).disabled;
}
