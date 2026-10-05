// SPDX-FileCopyrightText: 2026 Open Print Stack contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  emptyTelemetry,
  type PrinterStatus,
  type Telemetry,
} from "@openprintstack/protocol";
import { describe, expect, it } from "vitest";

import { type DriverMessage, reduceTelemetry } from "./index.ts";

function deepFreeze<T>(value: T): T {
  if (typeof value === "object" && value !== null) {
    Object.values(value).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
}

const telemetry: Telemetry = deepFreeze({
  temperatures: {
    nozzle: { actualC: 214.6, targetC: 215 },
    bed: { actualC: 59.8, targetC: 60 },
  },
  fans: { part: { percent: 100 } },
  speedPercent: 100,
  position: { x: 1, y: 2, z: 3 },
  homedAxes: ["x", "y", "z"],
  job: null,
});

function status(value: PrinterStatus): DriverMessage {
  return { type: "status", status: value, detail: null, error: null };
}

describe("reduceTelemetry", () => {
  it("replaces each top-level field the patch sets, and keeps the rest", () => {
    const next = reduceTelemetry(telemetry, {
      type: "telemetry",
      telemetry: { speedPercent: 120, position: null },
    });

    expect(next).toEqual({ ...telemetry, speedPercent: 120, position: null });
  });

  it("replaces every heater when the patch sets temperatures", () => {
    const next = reduceTelemetry(telemetry, {
      type: "telemetry",
      telemetry: { temperatures: { nozzle: { actualC: 20, targetC: 0 } } },
    });

    expect(next.temperatures).toEqual({ nozzle: { actualC: 20, targetC: 0 } });
  });

  it("treats a field set to undefined as unchanged", () => {
    const next = reduceTelemetry(telemetry, {
      type: "telemetry",
      telemetry: { speedPercent: undefined, homedAxes: null },
    });

    expect(next).toEqual({ ...telemetry, homedAxes: null });
    expect(next.speedPercent).toBe(100);
  });

  it("returns the same telemetry for an empty patch", () => {
    expect(
      reduceTelemetry(telemetry, { type: "telemetry", telemetry: {} }),
    ).toBe(telemetry);
  });

  it("sets job from a job message", () => {
    const job = {
      fileName: "benchy.gcode",
      progressPercent: 10,
      elapsedS: 60,
      remainingS: null,
      currentLayer: null,
      totalLayers: null,
    };

    const started = reduceTelemetry(telemetry, { type: "job", job });
    expect(started).toEqual({ ...telemetry, job });
    expect(reduceTelemetry(started, { type: "job", job: null })).toEqual(
      telemetry,
    );
  });

  it.each(["offline", "connecting"] as const)(
    "resets to nothing reported when the printer goes %s",
    (value) => {
      expect(reduceTelemetry(telemetry, status(value))).toEqual(
        emptyTelemetry(),
      );
    },
  );

  it.each(["idle", "printing", "error"] as const)(
    "keeps telemetry when the status is %s",
    (value) => {
      expect(reduceTelemetry(telemetry, status(value))).toBe(telemetry);
    },
  );

  it("doesn't let a patch after a reconnect bring stale readings back", () => {
    const offline = reduceTelemetry(telemetry, status("offline"));
    const next = reduceTelemetry(offline, {
      type: "telemetry",
      telemetry: { speedPercent: 100 },
    });

    expect(next.homedAxes).toBeNull();
    expect(next.position).toBeNull();
  });

  it("returns the same telemetry for messages that don't touch it", () => {
    expect(reduceTelemetry(telemetry, { type: "files_changed" })).toBe(
      telemetry,
    );
  });
});
