// SPDX-FileCopyrightText: 2026 Open Print Stack contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  DriverError,
  type DriverMessageOf,
  type MoveRequest,
  type SetFanRequest,
  type SetTemperatureRequest,
} from "@openprintstack/driver-sdk";
import {
  type Axis,
  COMMAND_POLICY,
  type CommandKind,
  type ErrorInfo,
  type Filament,
  type JobProgress,
  type PrinterStatus,
  type Telemetry,
} from "@openprintstack/protocol";

import { simulatedFilament } from "./filament.ts";
import type { SimulatedSettings } from "./settings.ts";

// The simulated printer itself: what a real printer's firmware would do. It
// has no timers and never emits; the driver advances it on each tick, reads
// its state, and reports what changed.

export const AMBIENT_C = 25;

/** Preparing heats to these, or to the heater's maximum if that is lower. */
export const PRINT_TEMPERATURES_C = { nozzle: 210, bed: 60 } as const;

/**
 * The chamber has no heater: it settles this share of the way from the room's
 * temperature to the bed's, and moves at this share of the bed's rate.
 */
export const CHAMBER_SHARE = 1 / 3;

/** The hotend fan runs at 100 % while the nozzle is hotter than this. */
export const HOTEND_FAN_ON_C = 50;

export const TOTAL_LAYERS = 100;

/** How long the in-between statuses last, in simulated seconds. */
export const TRANSITION_S = { pausing: 2, cancelling: 2, homing: 6 } as const;

export const SIMULATED_ERROR_CODE = "simulated_error";

const AXES: readonly Axis[] = ["x", "y", "z"];

/** The printer's own statuses. Offline and connecting belong to the link. */
export type MachineStatus = Exclude<PrinterStatus, "connecting" | "offline">;

export type StatusInfo = {
  status: MachineStatus;
  detail: string | null;
  error: ErrorInfo | null;
};

/** Things that happen, as opposed to state: they can't be re-read later. */
export type PrinterEvent =
  DriverMessageOf<"job_lifecycle"> | DriverMessageOf<"alert">;

type HeaterId = "nozzle" | "bed";

type Heater = {
  readonly id: HeaterId;
  readonly label: string;
  readonly maxC: number;
  /** °C per simulated second, heating or cooling. */
  readonly ratePerS: number;
  actualC: number;
  /** 0 turns the heater off. */
  targetC: number;
};

type Job = {
  readonly fileName: string;
  /** Simulated seconds spent printing, which progress is measured by. */
  printedS: number;
  /** Simulated seconds since the print started, including heat-up and pauses. */
  elapsedS: number;
  /** Where a resume goes back to. */
  resumeTo: "preparing" | "printing";
};

/**
 * Each heater changes at a steady rate, chosen so that heating from ambient to
 * print temperature takes exactly `heatUpS`.
 */
function heatRate(toC: number, heatUpS: number): number {
  return heatUpS === 0 ? Infinity : (toC - AMBIENT_C) / heatUpS;
}

/** Moves `fromC` towards `goalC` by at most `ratePerS` × `dtS`. */
function approach(
  fromC: number,
  goalC: number,
  ratePerS: number,
  dtS: number,
): number {
  const gap = goalC - fromC;
  const step = ratePerS * dtS;
  return Math.abs(gap) <= step ? goalC : fromC + Math.sign(gap) * step;
}

function stepHeater(heater: Heater, dtS: number): void {
  // A heater that is off cools to the room's temperature, never below it.
  const goal = Math.max(heater.targetC, AMBIENT_C);
  heater.actualC = approach(heater.actualC, goal, heater.ratePerS, dtS);
}

/** Whether preparing can stop waiting for this heater. */
function atTarget(heater: Heater): boolean {
  return heater.targetC <= AMBIENT_C || heater.actualC === heater.targetC;
}

function round(value: number, digits: number): number {
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}

export class SimulatedPrinter {
  readonly #settings: SimulatedSettings;
  readonly #heaters: readonly Heater[];
  /** The chamber sensor's temperature, which follows the bed's. */
  #chamberC = AMBIENT_C;
  readonly #volumeMm: Readonly<Record<Axis, number>>;
  readonly #homed = new Set<Axis>();
  readonly #position: Record<Axis, number> = { x: 0, y: 0, z: 0 };
  #partFanPercent = 0;
  #status: MachineStatus = "idle";
  #detail: string | null = null;
  #error: ErrorInfo | null = null;
  /** Simulated seconds and ticks since the status last changed. */
  #statusS = 0;
  #statusTicks = 0;
  #homing: Axis[] = [];
  #job: Job | null = null;
  #events: PrinterEvent[] = [];

  constructor(settings: SimulatedSettings) {
    this.#settings = settings;
    const heater = (
      id: HeaterId,
      label: string,
      maxC: number,
      ratePerS: number,
    ): Heater => ({
      id,
      label,
      maxC,
      ratePerS,
      actualC: AMBIENT_C,
      targetC: 0,
    });
    const bedRate = heatRate(PRINT_TEMPERATURES_C.bed, settings.heatUpS);
    this.#heaters = [
      heater(
        "nozzle",
        "nozzle",
        settings.nozzleMaxC,
        heatRate(PRINT_TEMPERATURES_C.nozzle, settings.heatUpS),
      ),
      heater("bed", "bed", settings.bedMaxC, bedRate),
    ];
    this.#volumeMm = {
      x: settings.buildVolumeXMm,
      y: settings.buildVolumeYMm,
      z: settings.buildVolumeZMm,
    };
  }

  get status(): MachineStatus {
    return this.#status;
  }

  /** The file being printed, or null when there is no job. */
  get jobFileName(): string | null {
    return this.#job?.fileName ?? null;
  }

  statusInfo(): StatusInfo {
    return { status: this.#status, detail: this.#detail, error: this.#error };
  }

  /** Every telemetry field except `job`, which `job()` reports. */
  telemetry(): Omit<Telemetry, "job"> {
    const nozzle = this.#heater("nozzle");
    const allHomed = AXES.every((axis) => this.#homed.has(axis));
    return {
      temperatures: {
        ...Object.fromEntries(
          this.#heaters.map((heater) => [
            heater.id,
            { actualC: round(heater.actualC, 1), targetC: heater.targetC },
          ]),
        ),
        // A sensor has no target.
        chamber: { actualC: round(this.#chamberC, 1), targetC: null },
      },
      fans: {
        part: { percent: this.#partFanPercent },
        hotend: { percent: nozzle.actualC > HOTEND_FAN_ON_C ? 100 : 0 },
      },
      speedPercent: 100,
      position: allHomed ? { ...this.#position } : null,
      homedAxes: AXES.filter((axis) => this.#homed.has(axis)),
    };
  }

  job(): JobProgress | null {
    const job = this.#job;
    if (job === null) {
      return null;
    }
    const durationS = this.#settings.printDurationS;
    const printedS = Math.min(job.printedS, durationS);
    const fraction = printedS / durationS;
    return {
      fileName: job.fileName,
      progressPercent: round(fraction * 100, 1),
      elapsedS: Math.round(job.elapsedS),
      remainingS: Math.ceil(durationS - printedS),
      currentLayer: Math.max(1, Math.ceil(fraction * TOTAL_LAYERS)),
      totalLayers: TOTAL_LAYERS,
    };
  }

  /** The filament changer's readout, or null if it has none. */
  filament(): Filament | null {
    return simulatedFilament(this.#settings, this.#job !== null);
  }

  /** The events since the last call, oldest first. */
  takeEvents(): PrinterEvent[] {
    const events = this.#events;
    this.#events = [];
    return events;
  }

  /** Runs the printer for one tick of `dtS` simulated seconds. */
  advance(dtS: number): void {
    for (const heater of this.#heaters) {
      stepHeater(heater, dtS);
    }
    const bed = this.#heater("bed");
    this.#chamberC = approach(
      this.#chamberC,
      AMBIENT_C + (bed.actualC - AMBIENT_C) * CHAMBER_SHARE,
      bed.ratePerS * CHAMBER_SHARE,
      dtS,
    );
    if (this.#job !== null) {
      this.#job.elapsedS += dtS;
    }
    this.#statusS += dtS;
    this.#statusTicks += 1;
    // A command can change the status just before a tick. Waiting for a
    // second tick means every status lasts at least one whole tick, so the
    // UI sees it even at 1000×.
    const settled = this.#statusTicks >= 2;

    switch (this.#status) {
      case "busy":
        if (settled && this.#statusS >= TRANSITION_S.homing) {
          this.#finishHoming();
        }
        return;
      case "preparing":
        if (settled && this.#heaters.every(atTarget)) {
          this.#enter("printing");
        }
        return;
      case "printing":
        if (this.#job !== null) {
          this.#job.printedS += dtS;
          if (this.#job.printedS >= this.#settings.printDurationS) {
            this.#endJob("completed");
          }
        }
        return;
      case "pausing":
        if (settled && this.#statusS >= TRANSITION_S.pausing) {
          this.#enter("paused", this.#detail);
        }
        return;
      case "cancelling":
        if (settled && this.#statusS >= TRANSITION_S.cancelling) {
          this.#endJob("cancelled");
        }
        return;
      default:
        return;
    }
  }

  // Commands. Each throws a DriverError, changing nothing, if the printer
  // can't do it now; the server has already checked the same rules.

  startPrint(fileName: string): void {
    this.#allow("print.start");
    this.#job = { fileName, printedS: 0, elapsedS: 0, resumeTo: "preparing" };
    this.#heater("nozzle").targetC = Math.min(
      PRINT_TEMPERATURES_C.nozzle,
      this.#settings.nozzleMaxC,
    );
    this.#heater("bed").targetC = Math.min(
      PRINT_TEMPERATURES_C.bed,
      this.#settings.bedMaxC,
    );
    this.#events.push({ type: "job_lifecycle", event: "started", fileName });
    this.#enter("preparing", "Heating up");
  }

  pause(): void {
    this.#pause(null, "only a running print can pause");
  }

  resume(): void {
    this.#allow("print.resume");
    if (this.#job !== null) {
      this.#enter(this.#job.resumeTo);
    }
  }

  cancel(): void {
    this.#allow("print.cancel");
    if (this.#job === null) {
      throw new DriverError("invalid_state", "There is no job to cancel.");
    }
    this.#enter("cancelling");
  }

  /** An empty `axes` homes every axis. */
  home(axes: readonly Axis[]): void {
    this.#allow("motion.home");
    this.#homing = axes.length === 0 ? [...AXES] : [...new Set(axes)];
    this.#enter("busy", "Homing");
  }

  /** A relative move. Instant, and refused if it would leave the volume. */
  move({ x, y, z, speedMmS }: MoveRequest): void {
    this.#allow("motion.move");
    const deltas: Record<Axis, number | undefined> = { x, y, z };
    const unhomed = AXES.filter(
      (axis) => deltas[axis] !== undefined && !this.#homed.has(axis),
    );
    if (unhomed.length > 0) {
      throw new DriverError(
        "invalid_state",
        `Home ${unhomed.join(", ")} before moving.`,
      );
    }
    const maxSpeed = this.#settings.maxMoveSpeedMmS;
    if (speedMmS !== undefined && speedMmS > maxSpeed) {
      throw new DriverError(
        "printer_rejected",
        `${speedMmS} mm/s is faster than the printer's ${maxSpeed} mm/s.`,
      );
    }
    const target = { ...this.#position };
    for (const axis of AXES) {
      const delta = deltas[axis];
      if (delta === undefined) {
        continue;
      }
      // Rounded to a micrometre, so repeated jogs can reach an edge exactly.
      const to = round(target[axis] + delta, 3);
      const maxMm = this.#volumeMm[axis];
      if (to < 0 || to > maxMm) {
        throw new DriverError(
          "printer_rejected",
          `That move would take ${axis} to ${to} mm, outside 0–${maxMm} mm.`,
        );
      }
      target[axis] = to;
    }
    Object.assign(this.#position, target);
  }

  setTemperature({ heaterId, targetC }: SetTemperatureRequest): void {
    this.#allow("temperature.set");
    if (heaterId === "chamber") {
      throw new DriverError(
        "not_supported",
        "The chamber only reports its temperature.",
      );
    }
    const heater = this.#heaters.find((candidate) => candidate.id === heaterId);
    if (heater === undefined) {
      throw new DriverError(
        "not_supported",
        `The printer has no heater "${heaterId}".`,
      );
    }
    if (targetC > heater.maxC) {
      throw new DriverError(
        "printer_rejected",
        `${targetC} °C is above the ${heater.label}'s ${heater.maxC} °C maximum.`,
      );
    }
    heater.targetC = targetC;
  }

  setFan({ fanId, percent }: SetFanRequest): void {
    this.#allow("fan.set");
    if (fanId === "hotend") {
      throw new DriverError(
        "not_supported",
        "The hotend fan runs by itself while the nozzle is hot.",
      );
    }
    if (fanId !== "part") {
      throw new DriverError(
        "not_supported",
        `The printer has no fan "${fanId}".`,
      );
    }
    this.#partFanPercent = percent;
  }

  // Faults, from the `simulator` extension.

  /**
   * Puts the printer in error. A job freezes where it was: cancel ends it as
   * cancelled, and `clearError` ends it as failed. The heaters turn off, as
   * they would after a real firmware fault.
   */
  fail(message: string): void {
    if (this.#status === "error") {
      throw new DriverError(
        "invalid_state",
        "The printer is already in error.",
      );
    }
    for (const heater of this.#heaters) {
      heater.targetC = 0;
    }
    this.#enter("error", null, { code: SIMULATED_ERROR_CODE, message });
  }

  /** Pauses a running print and raises an alert. Resume carries on. */
  filamentRunout(): void {
    this.#pause("Filament ran out", "filament can only run out during a print");
    this.#events.push({
      type: "alert",
      severity: "warning",
      code: "filament_runout",
      message: "Filament ran out, so the print paused.",
    });
  }

  /** Leaves error for idle, ending a frozen job as failed. Else does nothing. */
  clearError(): void {
    if (this.#status !== "error") {
      return;
    }
    if (this.#job === null) {
      this.#enter("idle");
    } else {
      this.#endJob("failed");
    }
  }

  #pause(detail: string | null, refusal: string): void {
    const from = this.#status;
    if (this.#job === null || (from !== "preparing" && from !== "printing")) {
      throw new DriverError(
        "invalid_state",
        `The printer is ${from}: ${refusal}.`,
      );
    }
    this.#job.resumeTo = from;
    this.#enter("pausing", detail);
  }

  #finishHoming(): void {
    for (const axis of this.#homing) {
      this.#homed.add(axis);
      this.#position[axis] = 0;
    }
    this.#homing = [];
    this.#enter("idle");
  }

  /** Ends the job as typical end G-code does: heaters and part fan off. */
  #endJob(outcome: "completed" | "cancelled" | "failed"): void {
    if (this.#job !== null) {
      this.#events.push({
        type: "job_lifecycle",
        event: outcome,
        fileName: this.#job.fileName,
      });
    }
    this.#job = null;
    for (const heater of this.#heaters) {
      heater.targetC = 0;
    }
    this.#partFanPercent = 0;
    this.#enter("idle");
  }

  #enter(
    status: MachineStatus,
    detail: string | null = null,
    error: ErrorInfo | null = null,
  ): void {
    this.#status = status;
    this.#detail = detail;
    this.#error = error;
    this.#statusS = 0;
    this.#statusTicks = 0;
  }

  /** Mirrors the server's command policy, so the two always agree. */
  #allow(kind: CommandKind): void {
    if (!COMMAND_POLICY[kind].allowedStatuses.includes(this.#status)) {
      throw new DriverError(
        "invalid_state",
        `The printer is ${this.#status}, so it can't accept ${kind}.`,
      );
    }
  }

  #heater(id: HeaterId): Heater {
    const heater = this.#heaters.find((candidate) => candidate.id === id);
    if (heater === undefined) {
      throw new Error(`No heater ${id}.`);
    }
    return heater;
  }
}
