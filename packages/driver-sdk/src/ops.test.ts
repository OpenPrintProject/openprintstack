// SPDX-FileCopyrightText: 2026 Open Print Stack contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { CommandKind, type PrinterCommandOf } from "@openprintstack/protocol";
import { describe, expect, it } from "vitest";

import {
  callForCommand,
  DRIVER_OPS,
  type DriverCall,
  isDriverOp,
} from "./index.ts";

const cases: {
  [K in CommandKind]: [command: PrinterCommandOf<K>, call: DriverCall];
} = {
  "print.start": [
    { kind: "print.start", fileName: "benchy.gcode" },
    { op: "startPrint", args: { fileName: "benchy.gcode" } },
  ],
  "print.pause": [{ kind: "print.pause" }, { op: "pause", args: {} }],
  "print.resume": [{ kind: "print.resume" }, { op: "resume", args: {} }],
  "print.cancel": [{ kind: "print.cancel" }, { op: "cancel", args: {} }],
  "motion.home": [
    { kind: "motion.home", axes: ["z"] },
    { op: "home", args: { axes: ["z"] } },
  ],
  "motion.move": [
    { kind: "motion.move", x: -10, speedMmS: 50 },
    { op: "move", args: { x: -10, speedMmS: 50 } },
  ],
  "temperature.set": [
    { kind: "temperature.set", heaterId: "nozzle", targetC: 215 },
    { op: "setTemperature", args: { heaterId: "nozzle", targetC: 215 } },
  ],
  "fan.set": [
    { kind: "fan.set", fanId: "part", percent: 50 },
    { op: "setFan", args: { fanId: "part", percent: 50 } },
  ],
  "file.upload": [
    {
      kind: "file.upload",
      stagedFileId: "staged-1",
      fileName: "benchy.gcode",
      sizeBytes: 1234,
    },
    {
      op: "sendFile",
      args: {
        fileName: "benchy.gcode",
        sizeBytes: 1234,
        path: "/data/staging/staged-1",
      },
    },
  ],
  "extension.invoke": [
    {
      kind: "extension.invoke",
      extension: "simulator",
      action: "fault.disconnect",
      params: { durationS: 15 },
    },
    {
      op: "invokeExtension",
      args: {
        extension: "simulator",
        action: "fault.disconnect",
        params: { durationS: 15 },
      },
    },
  ],
};

describe("callForCommand", () => {
  it("covers every command kind", () => {
    expect(Object.keys(cases).sort()).toEqual([...CommandKind.options].sort());
  });

  it.each(Object.values(cases))("maps %o", (command, call) => {
    const path = (id: string) => `/data/staging/${id}`;

    expect(callForCommand(command, path)).toStrictEqual(call);
  });
});

describe("driver ops", () => {
  it("are the PrinterDriver methods", () => {
    expect(DRIVER_OPS).toEqual([
      "connect",
      "disconnect",
      "dispose",
      "listFiles",
      "sendFile",
      "startPrint",
      "pause",
      "resume",
      "cancel",
      "home",
      "move",
      "setTemperature",
      "setFan",
      "listCameras",
      "getSnapshot",
      "invokeExtension",
    ]);
  });

  it.each(["toString", "constructor", "__proto__", "explode", ""])(
    "don't include %o",
    (op) => {
      expect(isDriverOp(op)).toBe(false);
    },
  );
});
