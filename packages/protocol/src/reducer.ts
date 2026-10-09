// SPDX-FileCopyrightText: 2026 Open Print Stack contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { OpsEvent } from "./events.ts";
import type { PrinterState } from "./state.ts";
import { isOnline } from "./status.ts";
import { emptyTelemetry } from "./telemetry.ts";

/** The state of a printer before its driver has reported anything. */
export function initialPrinterState(ts: string): PrinterState {
  return {
    status: "connecting",
    statusDetail: null,
    error: null,
    telemetry: emptyTelemetry(),
    capabilities: null,
    filament: null,
    updatedAt: ts,
  };
}

/**
 * Applies one event to a printer's state. The server's state store and the web
 * app both use it, so they always agree. It is pure: it never mutates `state`,
 * and returns `state` itself for events that don't change it.
 *
 * Callers pass only events for this printer (`event.printerId`), and keep the
 * snapshot's `seq` and printer details themselves.
 */
export function reducePrinterState(
  state: PrinterState,
  event: OpsEvent,
): PrinterState {
  switch (event.type) {
    case "printer.status_changed": {
      const { status, detail, error } = event.payload;
      return {
        ...state,
        status,
        statusDetail: detail,
        error,
        // Readings from before a disconnect are stale, and a stale homed
        // position must never allow a jog. Capabilities and the filament
        // readout are kept: they're still the best guess.
        telemetry: isOnline(status) ? state.telemetry : emptyTelemetry(),
        updatedAt: event.ts,
      };
    }
    case "printer.telemetry":
      return {
        ...state,
        telemetry: event.payload.telemetry,
        updatedAt: event.ts,
      };
    case "printer.capabilities_changed":
      return {
        ...state,
        capabilities: event.payload.capabilities,
        updatedAt: event.ts,
      };
    case "printer.filament_changed":
      return {
        ...state,
        filament: event.payload.filament,
        updatedAt: event.ts,
      };
    default:
      return state;
  }
}
