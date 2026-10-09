// SPDX-FileCopyrightText: 2026 Open Print Stack contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

// The printer model on its own, advanced by hand: no timers, no transport.

import { DriverError } from "@openprintstack/driver-sdk";
import { COMMAND_POLICY, type CommandKind } from "@openprintstack/protocol";
import { describe, expect, it } from "vitest";

import {
  type MachineStatus,
  SIMULATED_ERROR_CODE,
  SimulatedPrinter,
} from "./printer.ts";
import { simulatedSettingsSchema } from "./settings.ts";
import type { SettingsInput } from "./test-utils.ts";

/** A 10 s print with a 2 s heat-up: preparing takes 4 ticks, printing 20. */
function createPrinter(settings: SettingsInput = {}): SimulatedPrinter {
  return new SimulatedPrinter(
    simulatedSettingsSchema.parse({
      printDurationS: 10,
      heatUpS: 2,
      ...settings,
    }),
  );
}

/** Runs `count` ticks of `dtS` simulated seconds (0.5 s is ×1 speed). */
function advance(printer: SimulatedPrinter, count: number, dtS = 0.5): void {
  for (let tick = 0; tick < count; tick++) {
    printer.advance(dtS);
  }
}

function temperature(printer: SimulatedPrinter, heaterId: string) {
  return printer.telemetry().temperatures[heaterId];
}

/** Starts a print and heats up until it is printing. */
function startPrinting(printer: SimulatedPrinter): void {
  printer.startPrint("cube.gcode");
  advance(printer, 4);
  expect(printer.status).toBe("printing");
}

function homeAll(printer: SimulatedPrinter): void {
  printer.home([]);
  advance(printer, 12);
  expect(printer.status).toBe("idle");
}

function refusal(step: () => void): DriverError {
  try {
    step();
  } catch (error) {
    if (error instanceof DriverError) {
      return error;
    }
    throw error;
  }
  throw new Error("Expected a DriverError, but nothing was thrown.");
}

describe("a new printer", () => {
  it("is idle, cold and unhomed, with no job", () => {
    const printer = createPrinter();

    expect(printer.statusInfo()).toEqual({
      status: "idle",
      detail: null,
      error: null,
    });
    expect(printer.telemetry()).toEqual({
      temperatures: {
        nozzle: { actualC: 25, targetC: 0 },
        bed: { actualC: 25, targetC: 0 },
        chamber: { actualC: 25, targetC: null },
      },
      fans: { part: { percent: 0 }, hotend: { percent: 0 } },
      speedPercent: 100,
      position: null,
      homedAxes: [],
    });
    expect(printer.job()).toBeNull();
    expect(printer.takeEvents()).toEqual([]);
  });
});

describe("heating", () => {
  it("heats the nozzle and bed at a steady rate, reaching print temperature in heatUpS", () => {
    const printer = createPrinter();
    printer.startPrint("cube.gcode");

    expect(printer.statusInfo()).toMatchObject({
      status: "preparing",
      detail: "Heating up",
    });
    const readings = [];
    for (let tick = 0; tick < 4; tick++) {
      printer.advance(0.5);
      readings.push([
        temperature(printer, "nozzle")?.actualC,
        temperature(printer, "bed")?.actualC,
      ]);
    }

    // 92.5 °C/s and 17.5 °C/s: 25 → 210 and 25 → 60 in 2 s.
    expect(readings).toEqual([
      [71.3, 33.8],
      [117.5, 42.5],
      [163.8, 51.3],
      [210, 60],
    ]);
    expect(temperature(printer, "nozzle")?.targetC).toBe(210);
    expect(temperature(printer, "bed")?.targetC).toBe(60);
    expect(printer.status).toBe("printing");
  });

  it("heats to the heater's maximum when that is below print temperature", () => {
    const printer = createPrinter({ nozzleMaxC: 200, bedMaxC: 50 });
    startPrinting(printer);

    expect(temperature(printer, "nozzle")).toEqual({
      actualC: 200,
      targetC: 200,
    });
    expect(temperature(printer, "bed")).toEqual({ actualC: 50, targetC: 50 });
  });

  it("jumps to its targets with heatUpS 0, but preparing still lasts a whole tick", () => {
    const printer = createPrinter({ heatUpS: 0 });
    printer.startPrint("cube.gcode");
    printer.advance(0.5);

    expect(temperature(printer, "nozzle")?.actualC).toBe(210);
    expect(printer.status).toBe("preparing");
    printer.advance(0.5);
    expect(printer.status).toBe("printing");
  });

  it("cools to ambient at the same rate, and never below it", () => {
    const printer = createPrinter();
    printer.setTemperature({ heaterId: "nozzle", targetC: 210 });
    advance(printer, 4);
    printer.setTemperature({ heaterId: "nozzle", targetC: 10 });

    advance(printer, 2);
    expect(temperature(printer, "nozzle")?.actualC).toBe(117.5);
    advance(printer, 10);
    expect(temperature(printer, "nozzle")).toEqual({
      actualC: 25,
      targetC: 10,
    });
  });

  it("warms the chamber with the bed, a third of the way from the room's temperature", () => {
    const printer = createPrinter();
    printer.startPrint("cube.gcode");
    const readings = [];
    for (let tick = 0; tick < 4; tick++) {
      printer.advance(0.5);
      readings.push(temperature(printer, "chamber"));
    }

    // The bed goes 25 → 60 °C, so the chamber goes 25 → 36.7 °C.
    expect(readings).toEqual([
      { actualC: 27.9, targetC: null },
      { actualC: 30.8, targetC: null },
      { actualC: 33.8, targetC: null },
      { actualC: 36.7, targetC: null },
    ]);

    printer.cancel();
    advance(printer, 12);
    expect(temperature(printer, "chamber")).toEqual({
      actualC: 25,
      targetC: null,
    });
  });

  it("refuses targets above a heater's maximum, the chamber sensor and unknown heaters", () => {
    const printer = createPrinter();

    expect(
      refusal(() =>
        printer.setTemperature({ heaterId: "nozzle", targetC: 301 }),
      ).code,
    ).toBe("printer_rejected");
    expect(
      refusal(() => printer.setTemperature({ heaterId: "bed", targetC: 121 }))
        .code,
    ).toBe("printer_rejected");
    expect(
      refusal(() =>
        printer.setTemperature({ heaterId: "chamber", targetC: 0 }),
      ),
    ).toMatchObject({
      code: "not_supported",
      message: "The chamber only reports its temperature.",
    });
    expect(
      refusal(() => printer.setTemperature({ heaterId: "tool1", targetC: 0 }))
        .code,
    ).toBe("not_supported");

    printer.setTemperature({ heaterId: "nozzle", targetC: 300 });
    expect(temperature(printer, "nozzle")?.targetC).toBe(300);
  });

  it("runs the hotend fan while the nozzle is above 50 °C", () => {
    const printer = createPrinter();
    printer.setTemperature({ heaterId: "nozzle", targetC: 50 });
    advance(printer, 4);
    expect(printer.telemetry().fans.hotend).toEqual({ percent: 0 });

    printer.setTemperature({ heaterId: "nozzle", targetC: 51 });
    advance(printer, 1);
    expect(printer.telemetry().fans.hotend).toEqual({ percent: 100 });

    printer.setTemperature({ heaterId: "nozzle", targetC: 0 });
    advance(printer, 1);
    expect(printer.telemetry().fans.hotend).toEqual({ percent: 0 });
  });
});

describe("filament", () => {
  const slots = (printer: SimulatedPrinter) =>
    printer.filament()?.units[0]?.slots.map((slot) => slot.status);

  it("reports none without the Filament slots setting", () => {
    expect(createPrinter().filament()).toBeNull();
  });

  it("reports one changer of 4 slots, the last one empty", () => {
    const printer = createPrinter({ filamentSlots: true });

    expect(printer.filament()).toEqual({
      units: [
        {
          id: "changer",
          kind: "changer",
          label: "Simulated changer",
          slots: [
            {
              id: "1",
              label: "Slot 1",
              status: "loaded",
              material: "PLA",
              name: "White",
              colorHex: "#ffffff",
              nozzleMinC: 190,
              nozzleMaxC: 230,
            },
            {
              id: "2",
              label: "Slot 2",
              status: "loaded",
              material: "PLA",
              name: "Black",
              colorHex: "#1a1a1a",
              nozzleMinC: 190,
              nozzleMaxC: 230,
            },
            {
              id: "3",
              label: "Slot 3",
              status: "loaded",
              material: "PETG",
              name: "Red",
              colorHex: "#c62828",
              nozzleMinC: 220,
              nozzleMaxC: 260,
            },
            {
              id: "4",
              label: "Slot 4",
              status: "empty",
              material: null,
              name: null,
              colorHex: null,
              nozzleMinC: null,
              nozzleMaxC: null,
            },
          ],
        },
      ],
    });
  });

  it("makes slot 1 active from the start of a job until it ends, through a pause and an error", () => {
    const printer = createPrinter({ filamentSlots: true });

    printer.startPrint("cube.gcode");
    expect(slots(printer)).toEqual(["active", "loaded", "loaded", "empty"]);
    advance(printer, 6);
    printer.pause();
    advance(printer, 6);
    expect(printer.status).toBe("paused");
    expect(slots(printer)?.[0]).toBe("active");
    printer.fail("Jammed.");
    expect(slots(printer)?.[0]).toBe("active");

    printer.clearError();
    expect(slots(printer)).toEqual(["loaded", "loaded", "loaded", "empty"]);
  });
});

describe("fans", () => {
  it("sets the part fan, and refuses the automatic hotend fan and unknown fans", () => {
    const printer = createPrinter();
    printer.setFan({ fanId: "part", percent: 40 });

    expect(printer.telemetry().fans.part).toEqual({ percent: 40 });
    expect(
      refusal(() => printer.setFan({ fanId: "hotend", percent: 0 })).code,
    ).toBe("not_supported");
    expect(
      refusal(() => printer.setFan({ fanId: "aux", percent: 0 })).code,
    ).toBe("not_supported");
  });
});

describe("a print", () => {
  it("reports its progress, time and layers", () => {
    const printer = createPrinter();
    printer.startPrint("cube.gcode");

    expect(printer.job()).toEqual({
      fileName: "cube.gcode",
      progressPercent: 0,
      elapsedS: 0,
      remainingS: 10,
      currentLayer: 1,
      totalLayers: 100,
    });

    advance(printer, 4 + 10);
    expect(printer.job()).toEqual({
      fileName: "cube.gcode",
      progressPercent: 50,
      elapsedS: 7, // including the 2 s heat-up
      remainingS: 5,
      currentLayer: 50,
      totalLayers: 100,
    });

    advance(printer, 9);
    expect(printer.job()).toMatchObject({
      progressPercent: 95,
      remainingS: 1,
      currentLayer: 95,
    });
  });

  it("completes: an event, heaters and part fan off, then idle with no job", () => {
    const printer = createPrinter();
    startPrinting(printer);
    printer.setFan({ fanId: "part", percent: 80 });

    advance(printer, 19);
    expect(printer.status).toBe("printing");
    printer.advance(0.5);

    expect(printer.statusInfo()).toEqual({
      status: "idle",
      detail: null,
      error: null,
    });
    expect(printer.job()).toBeNull();
    expect(printer.takeEvents()).toEqual([
      { type: "job_lifecycle", event: "started", fileName: "cube.gcode" },
      { type: "job_lifecycle", event: "completed", fileName: "cube.gcode" },
    ]);
    const telemetry = printer.telemetry();
    expect(telemetry.temperatures.nozzle?.targetC).toBe(0);
    expect(telemetry.temperatures.bed?.targetC).toBe(0);
    expect(telemetry.fans.part).toEqual({ percent: 0 });
  });

  it("counts pauses in elapsed time, but not in progress", () => {
    const printer = createPrinter();
    startPrinting(printer);
    advance(printer, 4);
    printer.pause();
    advance(printer, 10);

    expect(printer.status).toBe("paused");
    expect(printer.job()).toMatchObject({ progressPercent: 20, elapsedS: 9 });
  });

  it("pauses for 2 simulated seconds, keeps its heaters on, and resumes printing", () => {
    const printer = createPrinter();
    startPrinting(printer);
    printer.pause();

    expect(printer.status).toBe("pausing");
    advance(printer, 3);
    expect(printer.status).toBe("pausing");
    printer.advance(0.5);
    expect(printer.status).toBe("paused");
    expect(temperature(printer, "nozzle")?.targetC).toBe(210);

    printer.resume();
    expect(printer.status).toBe("printing");
  });

  it("resumes a pause from preparing back into preparing", () => {
    const printer = createPrinter();
    printer.startPrint("cube.gcode");
    printer.pause();
    advance(printer, 4);
    expect(printer.status).toBe("paused");

    printer.resume();
    expect(printer.status).toBe("preparing");
  });

  it("cancels in 2 simulated seconds, ending the job as cancelled", () => {
    const printer = createPrinter();
    startPrinting(printer);
    printer.takeEvents();
    printer.cancel();

    expect(printer.status).toBe("cancelling");
    advance(printer, 3);
    expect(printer.status).toBe("cancelling");
    printer.advance(0.5);

    expect(printer.status).toBe("idle");
    expect(printer.job()).toBeNull();
    expect(printer.takeEvents()).toEqual([
      { type: "job_lifecycle", event: "cancelled", fileName: "cube.gcode" },
    ]);
    expect(temperature(printer, "nozzle")?.targetC).toBe(0);
  });

  it("keeps every status for at least one whole tick, even at 1000×", () => {
    const printer = createPrinter({ printDurationS: 600, heatUpS: 20 });
    const tick = () => printer.advance(500);
    printer.startPrint("cube.gcode");

    tick(); // heated, but preparing has only had part of a tick
    expect(printer.status).toBe("preparing");
    tick();
    expect(printer.status).toBe("printing");

    printer.pause();
    tick();
    expect(printer.status).toBe("pausing");
    tick();
    expect(printer.status).toBe("paused");

    printer.resume();
    tick();
    tick();
    expect(printer.status).toBe("idle");
  });
});

describe("homing and moves", () => {
  it("is busy homing for 6 simulated seconds", () => {
    const printer = createPrinter();
    printer.home(["x"]);

    expect(printer.statusInfo()).toMatchObject({
      status: "busy",
      detail: "Homing",
    });
    advance(printer, 11);
    expect(printer.status).toBe("busy");
    printer.advance(0.5);
    expect(printer.status).toBe("idle");
  });

  it("reports the position only once every axis is homed, at 0,0,0", () => {
    const printer = createPrinter();
    printer.home(["x"]);
    advance(printer, 12);

    expect(printer.telemetry()).toMatchObject({
      homedAxes: ["x"],
      position: null,
    });

    printer.home(["z", "y", "z"]);
    advance(printer, 12);
    expect(printer.telemetry()).toMatchObject({
      homedAxes: ["x", "y", "z"],
      position: { x: 0, y: 0, z: 0 },
    });
  });

  it("refuses to move an unhomed axis", () => {
    const printer = createPrinter();
    printer.home(["x", "y"]);
    advance(printer, 12);

    const error = refusal(() => printer.move({ x: 1, z: 1 }));
    expect(error.code).toBe("invalid_state");
    expect(error.message).toBe("Home z before moving.");
    printer.move({ x: 1, y: 2 });
  });

  it("moves relatively and at once, landing exactly on repeated small steps", () => {
    const printer = createPrinter();
    homeAll(printer);

    printer.move({ x: 10, y: 20 });
    printer.move({ x: 5, z: 1 });
    for (let step = 0; step < 10; step++) {
      printer.move({ z: 0.1 });
    }

    expect(printer.status).toBe("idle");
    expect(printer.telemetry().position).toEqual({ x: 15, y: 20, z: 2 });
  });

  it("refuses a move that would leave the build volume, moving nothing", () => {
    const printer = createPrinter({ buildVolumeXMm: 200 });
    homeAll(printer);

    const error = refusal(() => printer.move({ x: 10, z: -1 }));
    expect(error.code).toBe("printer_rejected");
    expect(error.message).toBe(
      "That move would take z to -1 mm, outside 0–256 mm.",
    );
    expect(refusal(() => printer.move({ x: 200.001 })).code).toBe(
      "printer_rejected",
    );
    expect(printer.telemetry().position).toEqual({ x: 0, y: 0, z: 0 });

    printer.move({ x: 200 });
    expect(printer.telemetry().position).toEqual({ x: 200, y: 0, z: 0 });
  });

  it("refuses a move faster than maxMoveSpeedMmS", () => {
    const printer = createPrinter({ maxMoveSpeedMmS: 100 });
    homeAll(printer);

    expect(refusal(() => printer.move({ x: 1, speedMmS: 101 })).code).toBe(
      "printer_rejected",
    );
    printer.move({ x: 1, speedMmS: 100 });
  });
});

describe("command rules", () => {
  /** Puts a homed printer into `status`; error has a frozen job. */
  function printerIn(status: MachineStatus): SimulatedPrinter {
    const printer = createPrinter();
    homeAll(printer);
    const reach: Record<MachineStatus, () => void> = {
      idle: () => undefined,
      busy: () => printer.home([]),
      preparing: () => printer.startPrint("cube.gcode"),
      printing: () => startPrinting(printer),
      pausing: () => {
        startPrinting(printer);
        printer.pause();
      },
      paused: () => {
        startPrinting(printer);
        printer.pause();
        advance(printer, 4);
      },
      cancelling: () => {
        startPrinting(printer);
        printer.cancel();
      },
      error: () => {
        startPrinting(printer);
        printer.fail("Boom.");
      },
    };
    reach[status]();
    expect(printer.status).toBe(status);
    return printer;
  }

  const attempts: Partial<
    Record<CommandKind, (printer: SimulatedPrinter) => void>
  > = {
    "print.start": (printer) => printer.startPrint("cube.gcode"),
    "print.pause": (printer) => printer.pause(),
    "print.resume": (printer) => printer.resume(),
    "print.cancel": (printer) => printer.cancel(),
    "motion.home": (printer) => printer.home([]),
    "motion.move": (printer) => printer.move({ x: 0 }),
    "temperature.set": (printer) =>
      printer.setTemperature({ heaterId: "nozzle", targetC: 0 }),
    "fan.set": (printer) => printer.setFan({ fanId: "part", percent: 0 }),
  };
  const statuses: MachineStatus[] = [
    "idle",
    "busy",
    "preparing",
    "printing",
    "pausing",
    "paused",
    "cancelling",
    "error",
  ];
  const cases = statuses.flatMap((status) =>
    Object.entries(attempts).map(([kind, attempt]) => ({
      status,
      kind: kind as CommandKind,
      attempt,
    })),
  );

  it.each(cases)(
    "agrees with COMMAND_POLICY on $kind while $status",
    ({ status, kind, attempt }) => {
      const printer = printerIn(status);
      const allowed = COMMAND_POLICY[kind].allowedStatuses.includes(status);

      if (allowed) {
        attempt(printer);
      } else {
        expect(refusal(() => attempt(printer)).code).toBe("invalid_state");
        expect(printer.status).toBe(status);
      }
    },
  );

  it("refuses to cancel when an error has no job", () => {
    const printer = createPrinter();
    printer.fail("Boom.");

    expect(refusal(() => printer.cancel()).message).toBe(
      "There is no job to cancel.",
    );
  });
});

describe("faults", () => {
  it("an error freezes the job and turns the heaters off", () => {
    const printer = createPrinter();
    startPrinting(printer);
    advance(printer, 4);
    printer.fail("Thermal runaway.");

    expect(printer.statusInfo()).toEqual({
      status: "error",
      detail: null,
      error: { code: SIMULATED_ERROR_CODE, message: "Thermal runaway." },
    });
    expect(temperature(printer, "nozzle")?.targetC).toBe(0);
    expect(temperature(printer, "bed")?.targetC).toBe(0);

    advance(printer, 10);
    expect(printer.status).toBe("error");
    expect(printer.job()).toMatchObject({ progressPercent: 20, elapsedS: 9 });
  });

  it("cancelling a frozen job ends it as cancelled", () => {
    const printer = createPrinter();
    startPrinting(printer);
    printer.fail("Boom.");
    printer.takeEvents();

    printer.cancel();
    advance(printer, 4);

    expect(printer.status).toBe("idle");
    expect(printer.takeEvents()).toEqual([
      { type: "job_lifecycle", event: "cancelled", fileName: "cube.gcode" },
    ]);
  });

  it("clearing an error ends a frozen job as failed and returns to idle", () => {
    const printer = createPrinter();
    startPrinting(printer);
    printer.fail("Boom.");
    printer.takeEvents();

    printer.clearError();

    expect(printer.statusInfo()).toEqual({
      status: "idle",
      detail: null,
      error: null,
    });
    expect(printer.job()).toBeNull();
    expect(printer.takeEvents()).toEqual([
      { type: "job_lifecycle", event: "failed", fileName: "cube.gcode" },
    ]);
  });

  it("clearing does nothing unless the printer is in error", () => {
    const printer = createPrinter();
    startPrinting(printer);
    printer.clearError();

    expect(printer.status).toBe("printing");
  });

  it("an error while homing leaves the axes unhomed", () => {
    const printer = createPrinter();
    printer.home([]);
    printer.fail("Boom.");
    printer.clearError();
    advance(printer, 20);

    expect(printer.status).toBe("idle");
    expect(printer.telemetry().homedAxes).toEqual([]);
  });

  it("refuses a second error", () => {
    const printer = createPrinter();
    printer.fail("Boom.");

    expect(refusal(() => printer.fail("Again.")).code).toBe("invalid_state");
    expect(printer.statusInfo().error?.message).toBe("Boom.");
  });

  it("a filament runout raises an alert and pauses; resume carries on", () => {
    const printer = createPrinter();
    startPrinting(printer);
    printer.takeEvents();
    printer.filamentRunout();

    expect(printer.takeEvents()).toEqual([
      {
        type: "alert",
        severity: "warning",
        code: "filament_runout",
        message: "Filament ran out, so the print paused.",
      },
    ]);
    expect(printer.statusInfo()).toMatchObject({
      status: "pausing",
      detail: "Filament ran out",
    });
    advance(printer, 4);
    expect(printer.statusInfo()).toMatchObject({
      status: "paused",
      detail: "Filament ran out",
    });

    printer.resume();
    expect(printer.statusInfo()).toMatchObject({
      status: "printing",
      detail: null,
    });
  });

  it("refuses a filament runout when no print is running", () => {
    const printer = createPrinter();
    expect(refusal(() => printer.filamentRunout()).code).toBe("invalid_state");

    startPrinting(printer);
    printer.pause();
    expect(refusal(() => printer.filamentRunout()).code).toBe("invalid_state");
    expect(printer.takeEvents()).toEqual([
      { type: "job_lifecycle", event: "started", fileName: "cube.gcode" },
    ]);
  });
});
