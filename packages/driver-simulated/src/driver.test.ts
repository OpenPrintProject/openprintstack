// SPDX-FileCopyrightText: 2026 Open Print Stack contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

// Scenarios through the cloning loopback, as the host runs the driver, on
// Vitest's fake timers. The loopback delivers on a microtask, which fake
// timers leave alone, so calls resolve without advancing time.

import type { InvokeExtensionRequest } from "@openprintstack/driver-sdk";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DEFAULT_ERROR_MESSAGE, DISCONNECT_DETAIL, TICK_MS } from "./driver.ts";
import { createSim, type SettingsInput, type Sim } from "./test-utils.ts";

/** A 10 s print with a 2 s heat-up: preparing takes 4 ticks, printing 20. */
const FAST: SettingsInput = { printDurationS: 10, heatUpS: 2 };

let sim: Sim;

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(async () => {
  expect(sim.protocolErrors).toEqual([]);
  expect(sim.emittedAfterDispose).toEqual([]);
  await sim.close();
  vi.useRealTimers();
});

async function connected(settings: SettingsInput = FAST): Promise<Sim> {
  sim = await createSim(settings);
  await sim.client.connect();
  return sim;
}

/** Uploads cube.gcode and starts printing it. */
async function startPrint(): Promise<void> {
  await sim.upload("cube.gcode");
  await sim.client.startPrint({ fileName: "cube.gcode" });
}

function simulator(
  action: string,
  params: InvokeExtensionRequest["params"] = null,
) {
  return sim.client.invokeExtension({ extension: "simulator", action, params });
}

describe("connecting", () => {
  it("reports capabilities, idle, no job and every telemetry field", async () => {
    await connected();

    expect(sim.messages.map((message) => message.type)).toEqual([
      "capabilities",
      "status",
      "job",
      "telemetry",
      "filament",
      "log",
    ]);
    expect(sim.all("filament")).toEqual([{ type: "filament", filament: null }]);
    expect(sim.statuses()).toEqual(["idle"]);
    expect(sim.telemetry()).toEqual({
      temperatures: {
        nozzle: { actualC: 25, targetC: 0 },
        bed: { actualC: 25, targetC: 0 },
        chamber: { actualC: 25, targetC: null },
      },
      fans: { part: { percent: 0 }, hotend: { percent: 0 } },
      speedPercent: 100,
      position: null,
      homedAxes: [],
      job: null,
    });
  });

  it("sends nothing on a tick when nothing changed", async () => {
    await connected();
    const count = sim.messages.length;
    await sim.tick(10);

    expect(sim.messages).toHaveLength(count);
  });

  it("refuses everything but extensions before connecting", async () => {
    sim = await createSim(FAST);

    await expect(sim.client.listFiles()).rejects.toMatchObject({
      code: "offline",
    });
    await expect(sim.client.home({ axes: [] })).rejects.toMatchObject({
      code: "offline",
    });
    await expect(sim.client.listCameras()).rejects.toMatchObject({
      code: "offline",
    });
    await simulator("set_speed", { multiplier: 2 });
  });

  it("reports offline after disconnect, and everything again on reconnect", async () => {
    await connected();
    await sim.client.disconnect();
    expect(sim.status()).toBe("offline");
    // The host resets its telemetry when the printer goes offline.
    expect(sim.telemetry().speedPercent).toBeNull();

    const from = sim.messages.length;
    await sim.client.connect();

    expect(sim.since(from).map((message) => message.type)).toEqual([
      "capabilities",
      "status",
      "job",
      "telemetry",
      "filament",
    ]);
    expect(sim.telemetry()).toMatchObject({
      speedPercent: 100,
      homedAxes: [],
      fans: { part: { percent: 0 }, hotend: { percent: 0 } },
    });
  });
});

describe("a print", () => {
  it("goes preparing → printing → completed → idle, in that order", async () => {
    await connected();
    await sim.upload("cube.gcode");
    const from = sim.messages.length;
    await sim.client.startPrint({ fileName: "cube.gcode" });

    expect(sim.since(from)).toEqual([
      { type: "job_lifecycle", event: "started", fileName: "cube.gcode" },
      {
        type: "job",
        job: {
          fileName: "cube.gcode",
          progressPercent: 0,
          elapsedS: 0,
          remainingS: 10,
          currentLayer: 1,
          totalLayers: 100,
        },
      },
      {
        type: "telemetry",
        telemetry: {
          temperatures: {
            nozzle: { actualC: 25, targetC: 210 },
            bed: { actualC: 25, targetC: 60 },
            chamber: { actualC: 25, targetC: null },
          },
        },
      },
      {
        type: "status",
        status: "preparing",
        detail: "Heating up",
        error: null,
      },
    ]);

    await sim.tick(3);
    expect(sim.status()).toBe("preparing");
    expect(sim.telemetry().temperatures.nozzle?.actualC).toBe(163.8);
    await sim.tick();
    expect(sim.status()).toBe("printing");

    await sim.tick(19);
    expect(sim.telemetry().job).toMatchObject({ progressPercent: 95 });
    const end = sim.messages.length;
    await sim.tick();

    expect(sim.since(end)).toEqual([
      { type: "job_lifecycle", event: "completed", fileName: "cube.gcode" },
      { type: "job", job: null },
      {
        type: "telemetry",
        telemetry: {
          temperatures: {
            nozzle: { actualC: 210, targetC: 0 },
            bed: { actualC: 60, targetC: 0 },
            chamber: { actualC: 36.7, targetC: null },
          },
        },
      },
      { type: "status", status: "idle", detail: null, error: null },
    ]);
    expect(sim.statuses()).toEqual(["idle", "preparing", "printing", "idle"]);
  });

  it("takes about 11 real seconds for the default 600 s print at ×60", async () => {
    await connected({ speedMultiplier: 60 });
    await startPrint();

    // 30 simulated seconds a tick: one tick heating, one to settle, then 20.
    await sim.tick(21);
    expect(sim.status()).toBe("printing");
    await sim.tick();
    expect(sim.status()).toBe("idle");
  });

  it("finishes the default print in 2 real seconds at 1000×, showing every status", async () => {
    await connected({ speedMultiplier: 1000 });
    await startPrint();
    await vi.advanceTimersByTimeAsync(2000);

    expect(sim.statuses()).toEqual(["idle", "preparing", "printing", "idle"]);
    expect(sim.all("job_lifecycle").map((message) => message.event)).toEqual([
      "started",
      "completed",
    ]);
  });

  it("pauses, resumes and cancels through pausing and cancelling", async () => {
    await connected();
    await startPrint();
    await sim.tick(6);

    await sim.client.pause();
    await sim.tick(4);
    await sim.client.resume();
    await sim.tick(2);
    await sim.client.cancel();
    await sim.tick(4);

    expect(sim.statuses()).toEqual([
      "idle",
      "preparing",
      "printing",
      "pausing",
      "paused",
      "printing",
      "cancelling",
      "idle",
    ]);
    expect(sim.all("job_lifecycle").map((message) => message.event)).toEqual([
      "started",
      "cancelled",
    ]);
    expect(sim.telemetry().job).toBeNull();
  });

  it("refuses a print of a file it doesn't have", async () => {
    await connected();

    await expect(
      sim.client.startPrint({ fileName: "missing.gcode" }),
    ).rejects.toMatchObject({ code: "file_not_found" });
    expect(sim.status()).toBe("idle");
  });

  it("refuses commands its state doesn't allow", async () => {
    await connected();

    await expect(sim.client.pause()).rejects.toMatchObject({
      code: "invalid_state",
    });
    await expect(sim.client.move({ x: 1 })).rejects.toMatchObject({
      code: "invalid_state",
    });
  });
});

describe("filament slots", () => {
  const WITH_SLOTS: SettingsInput = { ...FAST, filamentSlots: true };

  /** Each filament message's slot statuses, in order. */
  function statuses(from = 0): (string[] | undefined)[] {
    return sim
      .since(from)
      .flatMap((message) =>
        message.type === "filament"
          ? [message.filament?.units[0]?.slots.map((slot) => slot.status)]
          : [],
      );
  }

  it("reports the changer when it connects", async () => {
    await connected(WITH_SLOTS);

    expect(statuses()).toEqual([["loaded", "loaded", "loaded", "empty"]]);
    expect(sim.all("filament")[0]?.filament?.units[0]).toMatchObject({
      id: "changer",
      kind: "changer",
      label: "Simulated changer",
    });
  });

  it("reports slot 1 active for a print, before the status, and loaded again before idle", async () => {
    await connected(WITH_SLOTS);
    await sim.upload("cube.gcode");
    const from = sim.messages.length;
    await sim.client.startPrint({ fileName: "cube.gcode" });

    expect(sim.since(from).map((message) => message.type)).toEqual([
      "job_lifecycle",
      "job",
      "telemetry",
      "filament",
      "status",
    ]);
    const end = sim.messages.length;
    await sim.tick(24);

    expect(sim.status()).toBe("idle");
    expect(
      sim
        .since(end)
        .slice(-2)
        .map((message) => message.type),
    ).toEqual(["filament", "status"]);
    expect(statuses()).toEqual([
      ["loaded", "loaded", "loaded", "empty"],
      ["active", "loaded", "loaded", "empty"],
      ["loaded", "loaded", "loaded", "empty"],
    ]);
  });

  it("reports the changer again on reconnect, for the host to compare", async () => {
    await connected(WITH_SLOTS);
    await sim.client.disconnect();
    const from = sim.messages.length;
    await sim.client.connect();

    expect(statuses(from)).toEqual([["loaded", "loaded", "loaded", "empty"]]);
  });
});

describe("motion, heat and fans", () => {
  it("homes through busy, then jogs", async () => {
    await connected();
    await sim.client.home({ axes: [] });
    await sim.tick(12);
    await sim.client.move({ x: 10, y: 5 });

    expect(sim.statuses()).toEqual(["idle", "busy", "idle"]);
    expect(sim.telemetry()).toMatchObject({
      homedAxes: ["x", "y", "z"],
      position: { x: 10, y: 5, z: 0 },
    });
  });

  it("reports temperatures as they move, and fans as they change", async () => {
    await connected();
    await sim.client.setTemperature({ heaterId: "bed", targetC: 60 });
    await sim.client.setFan({ fanId: "part", percent: 30 });
    await sim.tick(4);

    expect(sim.telemetry()).toMatchObject({
      temperatures: { bed: { actualC: 60, targetC: 60 } },
      fans: { part: { percent: 30 } },
    });
  });
});

describe("the simulator extension", () => {
  it("fault.error puts the printer in error, and clear fails the job", async () => {
    await connected();
    await startPrint();
    await sim.tick(6);
    await simulator("fault.error", { message: "Thermal runaway." });

    expect(sim.all("status").at(-1)).toEqual({
      type: "status",
      status: "error",
      detail: null,
      error: { code: "simulated_error", message: "Thermal runaway." },
    });

    await simulator("clear");
    expect(sim.status()).toBe("idle");
    expect(sim.all("job_lifecycle").map((message) => message.event)).toEqual([
      "started",
      "failed",
    ]);
  });

  it("fault.error has a default message, and cancel ends a frozen job", async () => {
    await connected();
    await startPrint();
    await simulator("fault.error", {});
    expect(sim.all("status").at(-1)?.error?.message).toBe(
      DEFAULT_ERROR_MESSAGE,
    );

    await sim.client.cancel();
    await sim.tick(4);
    expect(sim.status()).toBe("idle");
    expect(sim.all("job_lifecycle").at(-1)?.event).toBe("cancelled");
  });

  it("clear in error with no job returns to idle", async () => {
    await connected();
    await simulator("fault.error");
    await simulator("clear");

    expect(sim.statuses()).toEqual(["idle", "error", "idle"]);
  });

  it("fault.filament_runout raises an alert and pauses", async () => {
    await connected();
    await startPrint();
    await sim.tick(6);
    const from = sim.messages.length;
    await simulator("fault.filament_runout");
    await sim.tick(4);

    expect(sim.since(from).filter((message) => message.type !== "job")).toEqual(
      [
        {
          type: "alert",
          severity: "warning",
          code: "filament_runout",
          message: "Filament ran out, so the print paused.",
        },
        {
          type: "status",
          status: "pausing",
          detail: "Filament ran out",
          error: null,
        },
        {
          type: "status",
          status: "paused",
          detail: "Filament ran out",
          error: null,
        },
      ],
    );

    await sim.client.resume();
    expect(sim.status()).toBe("printing");
  });

  it("set_speed changes how fast simulated time runs", async () => {
    await connected();
    await simulator("set_speed", { multiplier: 1000 });
    await startPrint();
    await sim.tick(4);

    expect(sim.status()).toBe("idle");
    expect(sim.all("job_lifecycle").at(-1)?.event).toBe("completed");
  });

  it("answers unknown actions with not_supported", async () => {
    await connected();

    for (const action of [
      "fault.nope",
      "toString",
      "__proto__",
      "constructor",
    ]) {
      await expect(simulator(action)).rejects.toMatchObject({
        code: "not_supported",
      });
    }
  });

  it.each([
    ["fault.disconnect", { durationS: 0 }],
    ["fault.disconnect", { durationS: 3601 }],
    ["fault.disconnect", {}],
    ["fault.disconnect", null],
    ["set_speed", { multiplier: 0.09 }],
    ["set_speed", { multiplier: 1001 }],
    ["set_speed", { multiplier: "fast" }],
    ["fault.error", { message: "" }],
    ["fault.error", { message: "Boom.", extra: true }],
    ["clear", { now: true }],
    ["fault.filament_runout", 42],
  ])(
    "refuses %s with params %j as printer_rejected",
    async (action, params) => {
      await connected();

      await expect(simulator(action, params)).rejects.toMatchObject({
        code: "printer_rejected",
      });
      expect(sim.statuses()).toEqual(["idle"]);
    },
  );

  it("explains which params are wrong", async () => {
    await connected();

    await expect(
      simulator("fault.disconnect", { durationS: 0 }),
    ).rejects.toThrow(
      "Invalid params for fault.disconnect: durationS: Too small: expected number to be >=1.",
    );
  });

  it("needs the printer online for faults, but not for clear or set_speed", async () => {
    await connected();
    await sim.client.disconnect();

    for (const action of [
      "fault.error",
      "fault.filament_runout",
      "fault.disconnect",
    ]) {
      await expect(
        simulator(
          action,
          action === "fault.disconnect" ? { durationS: 5 } : null,
        ),
      ).rejects.toMatchObject({ code: "offline" });
    }
    await simulator("clear");
    await simulator("set_speed", { multiplier: 5 });
  });
});

describe("a simulated disconnect", () => {
  it("goes offline for durationS real seconds, then reconnects with everything", async () => {
    await connected({ ...FAST, speedMultiplier: 60 });
    await simulator("fault.disconnect", { durationS: 15 });

    expect(sim.all("status").at(-1)).toEqual({
      type: "status",
      status: "offline",
      detail: DISCONNECT_DETAIL,
      error: null,
    });
    await expect(sim.client.home({ axes: [] })).rejects.toMatchObject({
      code: "offline",
    });
    await expect(sim.client.listFiles()).rejects.toMatchObject({
      code: "offline",
    });

    // Real seconds, whatever the speed.
    await vi.advanceTimersByTimeAsync(14_999);
    expect(sim.status()).toBe("offline");
    const from = sim.messages.length;
    await vi.advanceTimersByTimeAsync(1);

    expect(sim.status()).toBe("idle");
    expect(sim.since(from).map((message) => message.type)).toEqual([
      "capabilities",
      "status",
      "job",
      "telemetry",
      "filament",
    ]);
    expect(sim.telemetry()).toEqual({
      temperatures: {
        nozzle: { actualC: 25, targetC: 0 },
        bed: { actualC: 25, targetC: 0 },
        chamber: { actualC: 25, targetC: null },
      },
      fans: { part: { percent: 0 }, hotend: { percent: 0 } },
      speedPercent: 100,
      position: null,
      homedAxes: [],
      job: null,
    });
    await sim.client.home({ axes: [] });
  });

  it("keeps printing while offline, and reports a job that finished meanwhile", async () => {
    await connected();
    await startPrint();
    await sim.tick(6);
    await simulator("fault.disconnect", { durationS: 15 });
    const offline = sim.messages.length;

    // The print ends 9 s later, while the printer is unreachable.
    await sim.tick(25);
    expect(sim.messages).toHaveLength(offline);
    await vi.advanceTimersByTimeAsync(15_000 - 25 * TICK_MS);

    expect(sim.since(offline)).toEqual([
      expect.objectContaining({ type: "capabilities" }),
      { type: "status", status: "idle", detail: null, error: null },
      { type: "job_lifecycle", event: "completed", fileName: "cube.gcode" },
      { type: "job", job: null },
      expect.objectContaining({ type: "telemetry" }),
      { type: "filament", filament: null },
    ]);
  });

  it("carries on with a print that is still running when it reconnects", async () => {
    await connected();
    await startPrint();
    await sim.tick(6);
    await simulator("fault.disconnect", { durationS: 2 });
    await vi.advanceTimersByTimeAsync(2000);

    expect(sim.status()).toBe("printing");
    expect(sim.telemetry().job).toMatchObject({ progressPercent: 30 });
  });

  it("ends early with clear", async () => {
    await connected();
    await simulator("fault.disconnect", { durationS: 3600 });
    await simulator("clear");

    expect(sim.statuses()).toEqual(["idle", "offline", "idle"]);
    expect(vi.getTimerCount()).toBe(1); // only the tick
  });

  it("clear also ends an error that was raised before the disconnect", async () => {
    await connected();
    await startPrint();
    await simulator("fault.error");
    await simulator("fault.disconnect", { durationS: 60 });
    const from = sim.messages.length;
    await simulator("clear");

    expect(sim.since(from).map((message) => message.type)).toEqual([
      "capabilities",
      "status",
      "job_lifecycle",
      "job",
      "telemetry",
      "filament",
    ]);
    expect(sim.status()).toBe("idle");
    expect(sim.all("job_lifecycle").at(-1)?.event).toBe("failed");
  });

  it("stays offline after the outage if the host disconnected meanwhile", async () => {
    await connected();
    await simulator("fault.disconnect", { durationS: 5 });
    await sim.client.disconnect();
    await vi.advanceTimersByTimeAsync(10_000);

    expect(sim.status()).toBe("offline");
  });

  it("reports offline to connect while the outage lasts, then reconnects by itself", async () => {
    await connected();
    await simulator("fault.disconnect", { durationS: 5 });
    await sim.client.disconnect();
    await sim.client.connect();

    expect(sim.all("status").at(-1)).toMatchObject({
      status: "offline",
      detail: DISCONNECT_DETAIL,
    });
    await vi.advanceTimersByTimeAsync(5000);
    expect(sim.status()).toBe("idle");
  });
});

describe("dispose", () => {
  it("releases every timer and emits nothing afterwards, even mid-print and mid-outage", async () => {
    await connected();
    await startPrint();
    await sim.tick(6);
    await simulator("fault.disconnect", { durationS: 60 });
    expect(vi.getTimerCount()).toBe(2);

    await sim.client.dispose();
    const count = sim.messages.length;

    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(120_000);
    expect(sim.messages).toHaveLength(count);
  });

  it("drops the report of an upload that finishes after dispose", async () => {
    await connected();
    const path = await sim.stage("late.gcode");
    const upload = sim.driver.sendFile({
      fileName: "late.gcode",
      sizeBytes: 4,
      path,
    });
    await sim.driver.dispose();
    await upload;

    expect(sim.all("files_changed")).toEqual([]);
  });
});
