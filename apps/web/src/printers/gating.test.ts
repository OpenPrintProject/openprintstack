// SPDX-FileCopyrightText: 2026 Open Print Stack contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  COMMAND_POLICY,
  CommandKind,
  isOnline,
  type PrinterState,
  PrinterStatus,
} from "@openprintstack/protocol";
import {
  capabilitiesFixture,
  snapshotFixture,
} from "@openprintstack/protocol/fixtures";
import { describe, expect, it } from "vitest";

import {
  commandGate,
  fanGate,
  heaterGate,
  HIDDEN,
  jogGate,
  simulatorGate,
  uploadGate,
  withLock,
} from "./gating.ts";

function state(
  status: PrinterStatus,
  changes: Partial<PrinterState> = {},
): PrinterState {
  return { ...snapshotFixture.state, status, ...changes };
}

const enabled = { shown: true, enabled: true };

function disabled(reason: string) {
  return { shown: true, enabled: false, reason };
}

describe("commandGate", () => {
  it.each([
    ["print.start", "idle", enabled],
    ["print.start", "printing", disabled("Only when the printer is idle.")],
    ["print.pause", "printing", enabled],
    [
      "print.pause",
      "paused",
      disabled("Only when the printer is preparing or printing."),
    ],
    ["print.resume", "paused", enabled],
    ["print.cancel", "error", enabled],
    [
      "print.cancel",
      "idle",
      disabled(
        "Only when the printer is preparing, printing, pausing, paused or in error.",
      ),
    ],
    ["motion.move", "offline", disabled("The printer is offline.")],
    ["motion.home", "connecting", disabled("The printer is still connecting.")],
    [
      "temperature.set",
      "error",
      disabled(
        "Only when the printer is idle, busy, preparing, printing, pausing or paused.",
      ),
    ],
    ["fan.set", "printing", enabled],
    ["extension.invoke", "offline", enabled],
    ["extension.invoke", "connecting", enabled],
  ] as const)("%s while %s", (kind, status, expected) => {
    expect(commandGate(state(status), kind)).toEqual(expected);
  });

  it("follows COMMAND_POLICY for every command and status", () => {
    for (const kind of CommandKind.options) {
      for (const status of PrinterStatus.options) {
        const policy = COMMAND_POLICY[kind];
        const allowed =
          policy.allowedStatuses.includes(status) &&
          (!policy.requiresOnline || isOnline(status));

        const gate = commandGate(state(status), kind);

        expect(gate.shown, `${kind} while ${status}`).toBe(true);
        expect(gate.shown && gate.enabled, `${kind} while ${status}`).toBe(
          allowed,
        );
      }
    }
  });

  it("hides every command before the printer reports its capabilities", () => {
    for (const kind of CommandKind.options) {
      expect(commandGate(state("idle", { capabilities: null }), kind)).toEqual(
        HIDDEN,
      );
    }
  });

  it("hides a command the printer doesn't support, whatever its status", () => {
    const capabilities = {
      ...capabilitiesFixture,
      commands: capabilitiesFixture.commands.filter(
        (kind) => kind !== "print.pause",
      ),
    };

    expect(
      commandGate(state("printing", { capabilities }), "print.pause"),
    ).toEqual(HIDDEN);
    expect(
      commandGate(state("printing", { capabilities }), "print.cancel"),
    ).toEqual(enabled);
  });
});

describe("jogGate", () => {
  const telemetry = snapshotFixture.state.telemetry;

  it("allows a jog along a homed axis with the position known, while idle", () => {
    expect(jogGate(state("idle"), "x")).toEqual(enabled);
  });

  it("refuses a jog along an axis that isn't homed", () => {
    const unhomed = state("idle", {
      telemetry: { ...telemetry, homedAxes: ["x", "y"] },
    });

    expect(jogGate(unhomed, "z")).toEqual(disabled("Home Z first."));
    expect(jogGate(unhomed, "x")).toEqual(enabled);
  });

  it("refuses every jog when the printer doesn't report homed axes", () => {
    const unknown = state("idle", {
      telemetry: { ...telemetry, homedAxes: null },
    });

    expect(jogGate(unknown, "x")).toEqual(disabled("Home X first."));
  });

  it("refuses a jog while the position isn't known", () => {
    const lost = state("idle", { telemetry: { ...telemetry, position: null } });

    expect(jogGate(lost, "y")).toEqual(
      disabled("Home first: the position isn't known."),
    );
  });

  it("gives the status's reason first", () => {
    expect(jogGate(state("printing"), "x")).toEqual(
      disabled("Only when the printer is idle."),
    );
  });

  it("is hidden when the printer can't move", () => {
    const capabilities = {
      ...capabilitiesFixture,
      commands: capabilitiesFixture.commands.filter(
        (kind) => kind !== "motion.move",
      ),
    };

    expect(jogGate(state("idle", { capabilities }), "x")).toEqual(HIDDEN);
  });
});

describe("fanGate", () => {
  it("follows fan.set for a controllable fan", () => {
    const fan = {
      id: "part",
      kind: "part",
      label: "Part",
      controllable: true,
    } as const;

    expect(fanGate(state("printing"), fan)).toEqual(enabled);
    expect(fanGate(state("offline"), fan)).toEqual(
      disabled("The printer is offline."),
    );
  });

  it("hides the control of a fan that only reports its speed", () => {
    const fan = {
      id: "hotend",
      kind: "other",
      label: "Hotend",
      controllable: false,
    } as const;

    expect(fanGate(state("printing"), fan)).toEqual(HIDDEN);
  });
});

describe("heaterGate", () => {
  it("follows temperature.set for a settable heater", () => {
    const heater = {
      id: "nozzle",
      kind: "nozzle",
      label: "Nozzle",
      controllable: true,
      maxC: 300,
    } as const;

    expect(heaterGate(state("printing"), heater)).toEqual(enabled);
    expect(heaterGate(state("offline"), heater)).toEqual(
      disabled("The printer is offline."),
    );
  });

  it("hides the controls of a heater that only reports its temperature", () => {
    const sensor = {
      id: "chamber",
      kind: "chamber",
      label: "Chamber",
      controllable: false,
      maxC: null,
    } as const;

    expect(heaterGate(state("idle"), sensor)).toEqual(HIDDEN);
  });
});

describe("uploadGate", () => {
  it("is enabled while online, in error too", () => {
    expect(uploadGate(state("printing"))).toEqual(enabled);
    expect(uploadGate(state("error"))).toEqual(enabled);
    expect(uploadGate(state("offline"))).toEqual(
      disabled("The printer is offline."),
    );
  });

  it("is hidden when the printer doesn't take uploads, though it lists the command", () => {
    const capabilities = {
      ...capabilitiesFixture,
      files: { ...capabilitiesFixture.files, upload: false },
    };

    expect(uploadGate(state("idle", { capabilities }))).toEqual(HIDDEN);
  });

  it("is hidden without the file.upload command", () => {
    const capabilities = {
      ...capabilitiesFixture,
      commands: capabilitiesFixture.commands.filter(
        (kind) => kind !== "file.upload",
      ),
    };

    expect(uploadGate(state("idle", { capabilities }))).toEqual(HIDDEN);
  });
});

describe("simulatorGate", () => {
  it("is enabled in every status, offline included, with the extension", () => {
    for (const status of PrinterStatus.options) {
      expect(simulatorGate(state(status))).toEqual(enabled);
    }
  });

  it("is hidden without the simulator extension", () => {
    const capabilities = { ...capabilitiesFixture, extensions: ["other"] };

    expect(simulatorGate(state("idle", { capabilities }))).toEqual(HIDDEN);
  });
});

describe("withLock", () => {
  it("disables an enabled control while another command runs", () => {
    expect(withLock(commandGate(state("idle"), "print.start"), true)).toEqual(
      disabled("Waiting for the printer's last command."),
    );
  });

  it("keeps a disabled control's own reason, and a hidden one hidden", () => {
    const refused = commandGate(state("printing"), "print.start");

    expect(withLock(refused, true)).toEqual(refused);
    expect(withLock(HIDDEN, true)).toEqual(HIDDEN);
  });

  it("changes nothing when nothing runs", () => {
    expect(withLock(commandGate(state("idle"), "print.start"), false)).toEqual(
      enabled,
    );
  });
});
