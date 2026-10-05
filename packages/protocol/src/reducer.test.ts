// SPDX-FileCopyrightText: 2026 Open Print Stack contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from "vitest";

import {
  capabilitiesFixture,
  eventFixtures,
  telemetryFixture,
  TS,
} from "./fixtures.ts";
import {
  emptyTelemetry,
  type EventType,
  initialPrinterState,
  type OpsEventOf,
  type PrinterState,
  type PrinterStatus,
  reducePrinterState,
  type Telemetry,
} from "./index.ts";

const LATER = "2026-10-05T12:00:05.000Z";

function deepFreeze<T>(value: T): T {
  if (typeof value === "object" && value !== null) {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

function statusChanged(
  status: PrinterStatus,
  detail: string | null = null,
): OpsEventOf<"printer.status_changed"> {
  return {
    ...eventFixtures["printer.status_changed"],
    ts: LATER,
    payload: { previous: null, status, detail, error: null },
  };
}

function telemetry(value: Telemetry): OpsEventOf<"printer.telemetry"> {
  return {
    ...eventFixtures["printer.telemetry"],
    ts: LATER,
    payload: { telemetry: value },
  };
}

function onlineState(): PrinterState {
  return {
    status: "printing",
    statusDetail: null,
    error: null,
    telemetry: telemetryFixture,
    capabilities: capabilitiesFixture,
    updatedAt: TS,
  };
}

describe("initialPrinterState", () => {
  it("is connecting, with nothing reported yet", () => {
    expect(initialPrinterState(TS)).toStrictEqual({
      status: "connecting",
      statusDetail: null,
      error: null,
      telemetry: emptyTelemetry(),
      capabilities: null,
      updatedAt: TS,
    });
  });
});

describe("reducePrinterState", () => {
  it("applies a status change", () => {
    const error = { code: "thermal_runaway", message: "Nozzle heater failed." };
    const state = reducePrinterState(onlineState(), {
      ...eventFixtures["printer.status_changed"],
      ts: LATER,
      payload: { previous: "printing", status: "error", detail: "Hot", error },
    });

    expect(state).toStrictEqual({
      ...onlineState(),
      status: "error",
      statusDetail: "Hot",
      error,
      updatedAt: LATER,
    });
  });

  it("keeps telemetry while the printer stays online", () => {
    const state = reducePrinterState(onlineState(), statusChanged("paused"));

    expect(state.telemetry).toStrictEqual(telemetryFixture);
  });

  it.each(["offline", "connecting"] as const)(
    "clears telemetry but keeps capabilities when the printer goes %s",
    (status) => {
      const state = reducePrinterState(onlineState(), statusChanged(status));

      expect(state.status).toBe(status);
      expect(state.telemetry).toStrictEqual(emptyTelemetry());
      expect(state.capabilities).toStrictEqual(capabilitiesFixture);
    },
  );

  it("clears a previous error when the status changes", () => {
    const failed = {
      ...onlineState(),
      status: "error",
      error: { code: "x", message: "y" },
    } satisfies PrinterState;

    const state = reducePrinterState(failed, statusChanged("idle"));

    expect(state.error).toBeNull();
  });

  it("replaces telemetry with the event's full telemetry", () => {
    const next: Telemetry = {
      ...emptyTelemetry(),
      temperatures: { bed: { actualC: 20, targetC: 0 } },
    };

    const state = reducePrinterState(onlineState(), telemetry(next));

    expect(state.telemetry).toStrictEqual(next);
    expect(state.updatedAt).toBe(LATER);
  });

  it("replaces capabilities", () => {
    const capabilities = { ...capabilitiesFixture, extensions: [] };

    const state = reducePrinterState(initialPrinterState(TS), {
      ...eventFixtures["printer.capabilities_changed"],
      ts: LATER,
      payload: { capabilities },
    });

    expect(state.capabilities).toStrictEqual(capabilities);
    expect(state.updatedAt).toBe(LATER);
  });

  const stateEvents: readonly EventType[] = [
    "printer.status_changed",
    "printer.telemetry",
    "printer.capabilities_changed",
  ];
  const otherEvents = Object.values(eventFixtures).filter(
    (event) => !stateEvents.includes(event.type),
  );

  it.each(otherEvents.map((event) => [event.type, event] as const))(
    "returns the same state for %s",
    (_type, event) => {
      const state = onlineState();

      expect(reducePrinterState(state, event)).toBe(state);
    },
  );

  it.each(Object.values(eventFixtures).map((e) => [e.type, e] as const))(
    "never mutates its input (%s)",
    (_type, event) => {
      const state = deepFreeze(onlineState());
      const frozenEvent = deepFreeze(structuredClone(event));

      expect(() => reducePrinterState(state, frozenEvent)).not.toThrow();
      expect(state).toStrictEqual(onlineState());
    },
  );

  it("follows a printer from boot to printing", () => {
    const events = [
      statusChanged("connecting"),
      {
        ...eventFixtures["printer.capabilities_changed"],
        payload: { capabilities: capabilitiesFixture },
      },
      statusChanged("idle"),
      telemetry(telemetryFixture),
      statusChanged("printing", "Layer 12"),
    ];

    const state = events.reduce(reducePrinterState, initialPrinterState(TS));

    expect(state).toStrictEqual({
      status: "printing",
      statusDetail: "Layer 12",
      error: null,
      telemetry: telemetryFixture,
      capabilities: capabilitiesFixture,
      updatedAt: LATER,
    });
  });
});
