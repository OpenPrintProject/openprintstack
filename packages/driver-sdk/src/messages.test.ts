// SPDX-FileCopyrightText: 2026 Open Print Stack contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from "vitest";

import { DriverMessage, JobLifecycleEvent } from "./index.ts";

const messages: DriverMessage[] = [
  {
    type: "status",
    status: "error",
    detail: "Thermal runaway",
    error: { code: "thermal_runaway", message: "Nozzle heater failed." },
  },
  { type: "status", status: "idle", detail: null, error: null },
  {
    type: "telemetry",
    telemetry: { speedPercent: 120, position: null, homedAxes: ["x"] },
  },
  { type: "telemetry", telemetry: {} },
  {
    type: "job",
    job: {
      fileName: "benchy.gcode",
      progressPercent: 42.5,
      elapsedS: 255,
      remainingS: 345,
      currentLayer: 12,
      totalLayers: 80,
    },
  },
  { type: "job", job: null },
  { type: "job_lifecycle", event: "started", fileName: "benchy.gcode" },
  { type: "job_lifecycle", event: "failed", fileName: "benchy.gcode" },
  {
    type: "capabilities",
    capabilities: {
      commands: ["print.start"],
      heaters: [],
      fans: [],
      axes: null,
      maxMoveSpeedMmS: null,
      files: {
        list: true,
        upload: false,
        acceptedExtensions: [],
        maxUploadBytes: null,
      },
      cameras: { snapshot: false, stream: false },
      extensions: [],
    },
  },
  { type: "files_changed" },
  {
    type: "alert",
    severity: "warning",
    code: "filament_runout",
    message: "Filament ran out.",
  },
  { type: "log", level: "warn", message: "Retrying.", data: { attempt: 3 } },
  { type: "log", level: "debug", message: "Tick." },
];

describe.each(messages.map((message) => [message.type, message] as const))(
  "a %s message",
  (_type, message) => {
    it("parses to itself", () => {
      expect(DriverMessage.parse(message)).toStrictEqual(message);
    });

    it("survives structuredClone and a JSON round trip", () => {
      expect(DriverMessage.parse(structuredClone(message))).toStrictEqual(
        message,
      );
      expect(
        DriverMessage.parse(JSON.parse(JSON.stringify(message))),
      ).toStrictEqual(message);
    });
  },
);

describe("DriverMessage", () => {
  it("has one variant per message type in the plan", () => {
    const types = DriverMessage.options.map(
      (option) => option.shape.type.value,
    );

    expect(types.sort()).toEqual(
      [
        "alert",
        "capabilities",
        "files_changed",
        "job",
        "job_lifecycle",
        "log",
        "status",
        "telemetry",
      ].sort(),
    );
  });

  it.each([
    [
      "a Date as status detail",
      { type: "status", status: "idle", detail: new Date(), error: null },
    ],
    ["an unknown status", { type: "status", status: "exploded" }],
    [
      "NaN in telemetry",
      { type: "telemetry", telemetry: { speedPercent: NaN } },
    ],
    [
      "a Date in log data",
      { type: "log", level: "info", message: "x", data: { at: new Date() } },
    ],
    ["an unknown log level", { type: "log", level: "fatal", message: "x" }],
    ["an empty alert code", { type: "alert", severity: "info", code: "" }],
    ["an unknown type", { type: "progress" }],
  ])("rejects %s", (_name, message) => {
    expect(DriverMessage.safeParse(message).success).toBe(false);
  });

  it("drops job from a telemetry patch; the job message sets it", () => {
    const parsed = DriverMessage.parse({
      type: "telemetry",
      telemetry: { speedPercent: 100, job: null },
    });

    expect(parsed).toEqual({
      type: "telemetry",
      telemetry: { speedPercent: 100 },
    });
  });

  it("doesn't range-check readings", () => {
    const message = {
      type: "telemetry",
      telemetry: { fans: { part: { percent: 100.2 } }, speedPercent: -5 },
    };

    expect(DriverMessage.safeParse(message).success).toBe(true);
  });
});

describe("JobLifecycleEvent", () => {
  it("is started or one of the job outcomes", () => {
    expect(JobLifecycleEvent.options).toEqual([
      "started",
      "completed",
      "cancelled",
      "failed",
    ]);
  });
});
