// SPDX-FileCopyrightText: 2026 Open Print Stack contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  type CommandKind,
  EventType,
  type OpsEvent,
  type OpsEventOf,
  type PrinterCommand,
} from "@openprintstack/protocol";
import {
  capabilitiesFixture,
  commandFixtures,
  COMMAND_ID,
  eventFixtures,
  PRINTER_ID,
  telemetryFixture,
  USER_ID,
} from "@openprintstack/protocol/fixtures";
import { describe, expect, it } from "vitest";

import {
  CATEGORY_LABEL,
  commandText,
  eventSummary,
  formatMs,
  type LogContext,
  sourceText,
  TYPE_LABEL,
} from "./describe.ts";

// What the page knows: the fixture printer's capabilities, and the requests
// in `requests`.
function contextWith(
  requests: Record<string, PrinterCommand> = {},
  known = true,
): LogContext {
  return {
    partLabel: (printerId, part, id) =>
      known && printerId === PRINTER_ID
        ? capabilitiesFixture[part].find((each) => each.id === id)?.label
        : undefined,
    request: (commandId) => requests[commandId],
  };
}

const CONTEXT = contextWith();

function summary<T extends EventType>(
  type: T,
  payload: OpsEventOf<T>["payload"],
  context = CONTEXT,
): string | null {
  return eventSummary({ ...eventFixtures[type], payload } as OpsEvent, context);
}

describe("labels", () => {
  it("name every type and category differently", () => {
    const types = Object.values(TYPE_LABEL);
    expect(Object.keys(TYPE_LABEL)).toEqual(EventType.options);
    expect(new Set(types).size).toBe(types.length);
    const categories = Object.values(CATEGORY_LABEL);
    expect(new Set(categories).size).toBe(categories.length);
  });
});

describe("eventSummary", () => {
  it("says what changed in a status, with its detail and error", () => {
    const change = {
      previous: "idle",
      status: "preparing",
      detail: "Heating up",
      error: null,
    } as const;

    expect(summary("printer.status_changed", change)).toBe(
      "Idle → Preparing · Heating up",
    );
    expect(
      summary("printer.status_changed", {
        ...change,
        previous: null,
        status: "connecting",
        detail: null,
      }),
    ).toBe("Connecting");
    expect(
      summary("printer.status_changed", {
        previous: "printing",
        status: "error",
        detail: "Stopped",
        error: { code: "sim", message: "A simulated error was injected." },
      }),
    ).toBe("Printing → Error · Stopped · A simulated error was injected.");
    expect(
      summary("printer.status_changed", {
        previous: "printing",
        status: "error",
        detail: "Boom",
        error: { code: "sim", message: "Boom" },
      }),
    ).toBe("Printing → Error · Boom");
  });

  it("sums up telemetry: each heater by its label, and the job", () => {
    const payload = { telemetry: telemetryFixture };

    expect(summary("printer.telemetry", payload)).toBe(
      "Nozzle 214.6 °C / 215 °C · Bed 59.8 °C / 60 °C · benchy.gcode 43 %",
    );
    expect(summary("printer.telemetry", payload, contextWith({}, false))).toBe(
      "nozzle 214.6 °C / 215 °C · bed 59.8 °C / 60 °C · benchy.gcode 43 %",
    );
    expect(
      summary("printer.telemetry", {
        telemetry: { ...telemetryFixture, temperatures: {}, job: null },
      }),
    ).toBe("No readings");
  });

  it("words alerts, jobs and printer changes", () => {
    expect(
      summary("printer.alert", {
        severity: "info",
        code: "x",
        message: "Hello",
      }),
    ).toBe("Info: Hello");
    expect(summary("printer.job_started", { fileName: "a.gcode" })).toBe(
      "a.gcode",
    );
    expect(
      summary("printer.job_ended", { outcome: "completed", fileName: "a" }),
    ).toBe("a finished");
    expect(
      summary("printer.job_ended", { outcome: "cancelled", fileName: "a" }),
    ).toBe("a was cancelled");
    expect(
      summary("printer.job_ended", { outcome: "failed", fileName: "a" }),
    ).toBe("a failed");
    expect(
      summary("printer.added", { name: "Sim 1", driverType: "simulated" }),
    ).toBe("Sim 1 (simulated)");
    expect(summary("printer.removed", { name: "Sim 1" })).toBe("Sim 1");
    expect(summary("printer.updated", { changedFields: ["name"] })).toBe(
      "Renamed",
    );
    expect(summary("printer.updated", { changedFields: ["settings"] })).toBe(
      "Settings changed",
    );
    expect(
      summary("printer.updated", { changedFields: ["settings", "name"] }),
    ).toBe("Renamed, Settings changed");
    expect(summary("printer.updated", { changedFields: [] })).toBeNull();
  });

  it("words auth and system events, and nothing where the label says it all", () => {
    expect(summary("auth.login_failed", { username: "bob" })).toBe(
      "Username “bob”",
    );
    expect(summary("auth.login_failed", { username: "" })).toBe("No username");
    expect(summary("system.started", { version: "0.1.0" })).toBe(
      "Version 0.1.0",
    );
    for (const type of [
      "printer.capabilities_changed",
      "printer.files_changed",
      "auth.setup_completed",
      "auth.login_succeeded",
      "auth.logout",
      "system.stopping",
    ] as const) {
      expect(eventSummary(eventFixtures[type], CONTEXT), type).toBeNull();
    }
  });

  it("names a command result's command when its request is loaded", () => {
    const result = {
      commandId: COMMAND_ID,
      ok: true,
      durationMs: 12.4,
    } as const;
    const requested = contextWith({ [COMMAND_ID]: { kind: "print.pause" } });

    expect(summary("command.result", result, requested)).toBe(
      "Pause the print: done in 12 ms",
    );
    expect(summary("command.result", result)).toBe("Done in 12 ms");
    const failed = {
      ...result,
      ok: false,
      error: { code: "printer_offline", message: "The printer is offline." },
    };
    expect(summary("command.result", failed, requested)).toBe(
      "Pause the print failed: The printer is offline.",
    );
    expect(summary("command.result", failed)).toBe(
      "Failed: The printer is offline.",
    );
    expect(summary("command.result", { ...result, ok: false })).toBe("Failed");
  });

  it("words a command request as its command", () => {
    expect(
      summary("command.requested", {
        commandId: COMMAND_ID,
        command: commandFixtures["temperature.set"],
      }),
    ).toBe("Set Nozzle to 215 °C");
  });
});

describe("commandText", () => {
  const text = (command: PrinterCommand, context = CONTEXT) =>
    commandText(command, PRINTER_ID, context);

  it.each([
    ["print.start", "Start benchy.gcode"],
    ["print.pause", "Pause the print"],
    ["print.resume", "Resume the print"],
    ["print.cancel", "Cancel the print"],
    ["motion.home", "Home all"],
    ["motion.move", "Move X −10 mm, Z +0.2 mm at 50 mm/s"],
    ["temperature.set", "Set Nozzle to 215 °C"],
    ["fan.set", "Set the Part cooling fan to 50 %"],
    ["file.upload", "Upload benchy.gcode (1.2 MB)"],
    ["extension.invoke", "Simulate a disconnect for 15 s"],
  ] satisfies [CommandKind, string][])("words %s", (kind, words) => {
    expect(text(commandFixtures[kind])).toBe(words);
  });

  it("words the variants", () => {
    expect(text({ kind: "motion.home", axes: ["x", "z"] })).toBe("Home X, Z");
    expect(text({ kind: "motion.move", y: 0 })).toBe("Move Y 0 mm");
    expect(text({ kind: "temperature.set", heaterId: "bed", targetC: 0 })).toBe(
      "Turn Bed off",
    );
    expect(
      text(commandFixtures["temperature.set"], contextWith({}, false)),
    ).toBe("Set nozzle to 215 °C");
    expect(text(commandFixtures["fan.set"], contextWith({}, false))).toBe(
      "Set the part fan to 50 %",
    );
  });

  it.each([
    ["fault.error", {}, "Simulate an error"],
    ["fault.filament_runout", {}, "Simulate a filament runout"],
    ["fault.disconnect", {}, "Simulate a disconnect"],
    ["clear", {}, "Clear the simulated faults"],
    ["set_speed", { multiplier: 60 }, "Set the simulation speed to ×60"],
    ["set_speed", null, "Set the simulation speed"],
    ["fault.new", {}, "simulator: fault.new"],
  ] as const)("words the simulator's %s", (action, params, words) => {
    expect(
      text({
        kind: "extension.invoke",
        extension: "simulator",
        action,
        params,
      }),
    ).toBe(words);
  });

  it("words another extension's action by its names", () => {
    expect(
      text({
        kind: "extension.invoke",
        extension: "klipper",
        action: "restart",
        params: {},
      }),
    ).toBe("klipper: restart");
  });
});

describe("sourceText", () => {
  it("names the user, the printer or the system", () => {
    const users = new Map([[USER_ID, "rob"]]);

    expect(sourceText({ kind: "user", userId: USER_ID }, users)).toBe("rob");
    expect(sourceText({ kind: "user", userId: "someone" }, users)).toBe(
      "A user",
    );
    expect(sourceText({ kind: "driver" }, users)).toBe("Printer");
    expect(sourceText({ kind: "system" }, users)).toBe("System");
  });
});

describe("formatMs", () => {
  it("shows milliseconds under a second, then seconds", () => {
    expect(formatMs(0)).toBe("0 ms");
    expect(formatMs(12.4)).toBe("12 ms");
    expect(formatMs(999.4)).toBe("999 ms");
    expect(formatMs(999.6)).toBe("1 s");
    expect(formatMs(2_540)).toBe("2.5 s");
    expect(formatMs(75_300)).toBe("75.3 s");
  });
});
