// SPDX-FileCopyrightText: 2026 Open Print Stack contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  type Capabilities,
  COMMAND_POLICY,
  type CommandKind,
  isOnline,
  PrinterStatus,
} from "@openprintstack/protocol";
import {
  capabilitiesFixture,
  filamentFixture,
} from "@openprintstack/protocol/fixtures";
import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { apiError, type FakeServer } from "../test/fake-server.ts";
import {
  buttonIn,
  card,
  enabled,
  IDLE_TELEMETRY,
  serverWith,
  type SnapshotChanges,
  without,
} from "../test/printers.ts";
import { heading, location, renderApp, settle } from "../test/render-app.tsx";

// A printer's page: what it shows, what it lets you do, and what it sends.

const JOB = {
  fileName: "benchy.gcode",
  progressPercent: 42.5,
  elapsedS: 3725,
  remainingS: 200,
  currentLayer: 12,
  totalLayers: 240,
};

/** Opens Sim 1's page and waits for it to be live. */
async function open(changes: SnapshotChanges = {}, server?: FakeServer) {
  const fake = server ?? serverWith(changes);
  fake.files.set("p1", [
    {
      name: "old.gcode",
      sizeBytes: 999,
      modifiedAt: "2026-10-01T09:00:00.000Z",
    },
    {
      name: "benchy.gcode",
      sizeBytes: 1_234_567,
      modifiedAt: "2026-10-06T12:00:00.000Z",
    },
  ]);
  fake.cameras.set("p1", [{ id: "main", label: "Simulated camera" }]);
  const rendered = renderApp(fake, "/printers/p1");
  await heading("Sim 1");
  await settle();
  return { ...rendered, server: fake };
}

function commands(server: FakeServer): unknown[] {
  return server.requestsTo("POST /api/printers/p1/commands");
}

/**
 * The control for each command kind, as the page labels it. Print is on each
 * file, and files are listed only while online.
 */
const CONTROLS: Record<
  Exclude<CommandKind, "file.upload">,
  () => HTMLElement | null
> = {
  "print.start": () =>
    screen.queryByRole("button", { name: "Print benchy.gcode" }),
  "print.pause": () => buttonIn("Print", "Pause"),
  "print.resume": () => buttonIn("Print", "Resume"),
  "print.cancel": () => buttonIn("Print", "Cancel"),
  "motion.home": () => buttonIn("Motion", "Home all"),
  "motion.move": () => buttonIn("Motion", "Move X by 10 mm"),
  "temperature.set": () => buttonIn("Temperatures", "Set the Nozzle"),
  "fan.set": () => within(card("Fans")).getByRole("slider"),
  "extension.invoke": () => buttonIn("Simulator", "Filament runout"),
};

function isEnabled(control: HTMLElement): boolean {
  // Radix's slider thumb says it's disabled with data-disabled.
  return control.getAttribute("role") === "slider"
    ? !control.hasAttribute("data-disabled")
    : enabled(control);
}

describe("gating by COMMAND_POLICY", () => {
  it.each(PrinterStatus.options)(
    "enables exactly what the policy allows while %s",
    async (status) => {
      await open({
        status,
        telemetry: status === "printing" ? { job: JOB } : {},
      });

      for (const [kind, control] of Object.entries(CONTROLS)) {
        const policy = COMMAND_POLICY[kind as CommandKind];
        const allowed =
          policy.allowedStatuses.includes(status) &&
          (!policy.requiresOnline || isOnline(status));
        const found = control();
        expect(
          found === null ? false : isEnabled(found),
          `${kind} while ${status}`,
        ).toBe(allowed);
        expect(found === null, `${kind} missing while ${status}`).toBe(
          kind === "print.start" && !isOnline(status),
        );
      }
      const upload = buttonIn("Files", "Upload");
      expect(enabled(upload), `file.upload while ${status}`).toBe(
        isOnline(status),
      );
    },
  );

  it("gives a disabled button's reason as its tooltip, and a card's under it", async () => {
    await open({ status: "printing", telemetry: { job: JOB } });

    expect(buttonIn("Print", "Resume").title).toBe(
      "Only when the printer is paused.",
    );
    expect(buttonIn("Motion", "Home all").title).toBe(
      "Only when the printer is idle.",
    );
    expect(
      within(card("Motion")).getByText("Only when the printer is idle."),
    ).toBeDefined();
  });

  it("says why everything is disabled while offline, but keeps the Simulator panel", async () => {
    await open({ status: "offline" });

    expect(
      within(card("Temperatures")).getByText("The printer is offline."),
    ).toBeDefined();
    expect(enabled(buttonIn("Simulator", "Clear"))).toBe(true);
    expect(enabled(buttonIn("Simulator", "Disconnect"))).toBe(true);
  });
});

describe("gating by capabilities", () => {
  it.each([
    ["Temperatures", "has no heaters", { ...capabilitiesFixture, heaters: [] }],
    ["Fans", "has no fans", { ...capabilitiesFixture, fans: [] }],
    ["Motion", "can't home or move", without("motion.home", "motion.move")],
    [
      "Camera",
      "has no snapshots",
      {
        ...capabilitiesFixture,
        cameras: { snapshot: false, stream: false },
      },
    ],
    [
      "Simulator",
      "has no simulator extension",
      { ...capabilitiesFixture, extensions: [] },
    ],
    [
      "Files",
      "neither lists nor takes files",
      {
        ...capabilitiesFixture,
        files: { ...capabilitiesFixture.files, list: false, upload: false },
      },
    ],
  ] satisfies [string, string, Capabilities][])(
    "hides %s when the printer %s",
    async (name, _, capabilities) => {
      await open({ capabilities });

      expect(screen.queryByRole("heading", { name, level: 2 })).toBeNull();
      expect(
        screen.getByRole("heading", { name: "Print", level: 2 }),
      ).toBeDefined();
    },
  );

  it("hides each control the printer doesn't support", async () => {
    await open({
      status: "printing",
      telemetry: { job: JOB },
      capabilities: without(
        "print.pause",
        "temperature.set",
        "fan.set",
        "motion.move",
        "file.upload",
        "print.start",
      ),
    });

    expect(
      within(card("Print")).queryByRole("button", { name: "Pause" }),
    ).toBeNull();
    expect(
      within(card("Print")).getByRole("button", { name: "Resume" }),
    ).toBeDefined();
    // Readings still show; the controls go.
    expect(within(card("Temperatures")).getByText("Nozzle")).toBeDefined();
    expect(within(card("Temperatures")).queryByRole("button")).toBeNull();
    expect(within(card("Fans")).queryByRole("slider")).toBeNull();
    expect(
      within(card("Motion")).getByRole("button", { name: "Home all" }),
    ).toBeDefined();
    expect(
      within(card("Motion")).queryByRole("button", { name: /^Move/ }),
    ).toBeNull();
    expect(
      within(card("Files")).queryByRole("button", { name: "Upload" }),
    ).toBeNull();
    expect(
      within(card("Files")).queryByRole("button", { name: /^Print / }),
    ).toBeNull();
    expect(within(card("Files")).getByText("benchy.gcode")).toBeDefined();
  });

  it("shows a fan that only reports its speed without a slider", async () => {
    await open({
      telemetry: { fans: { part: { percent: 50 }, hotend: { percent: 100 } } },
      capabilities: {
        ...capabilitiesFixture,
        fans: [
          ...capabilitiesFixture.fans,
          { id: "hotend", kind: "other", label: "Hotend", controllable: false },
        ],
      },
    });

    const fans = within(card("Fans"));
    expect(fans.getAllByRole("slider")).toHaveLength(1);
    expect(
      fans.getByRole("slider", { name: "Part cooling fan speed" }),
    ).toBeDefined();
    expect(fans.getByText("Hotend").nextSibling?.textContent).toBe("100 %");
  });

  it("shows only the status before the printer reports its capabilities", async () => {
    await open({ status: "connecting", capabilities: null });

    expect(
      screen.getByText("Waiting for the printer to say what it can do."),
    ).toBeDefined();
    expect(
      screen
        .getAllByRole("heading", { level: 2 })
        .map((each) => each.textContent),
    ).toEqual(["Print"]);
    expect(within(card("Print")).queryByRole("button")).toBeNull();
  });
});

describe("commands", () => {
  it("pauses and resumes, sending each command once", async () => {
    const { server, user } = await open({
      status: "printing",
      telemetry: { job: JOB },
    });

    await user.click(buttonIn("Print", "Pause"));
    server.publish("printer.status_changed", "p1", {
      previous: "printing",
      status: "paused",
      detail: null,
      error: null,
    });
    await waitFor(() => {
      expect(enabled(buttonIn("Print", "Resume"))).toBe(true);
    });
    await user.click(buttonIn("Print", "Resume"));

    await waitFor(() => {
      expect(commands(server)).toEqual([
        { kind: "print.pause" },
        { kind: "print.resume" },
      ]);
    });
  });

  it("locks the printer's controls while a command waits for its answer", async () => {
    const { server, user } = await open();
    server.holdCommands = true;

    await user.click(buttonIn("Motion", "Home all"));

    await waitFor(() => {
      expect(enabled(buttonIn("Motion", "Home all"))).toBe(false);
    });
    expect(buttonIn("Motion", "Home all").title).toBe(
      "Waiting for the printer's last command.",
    );
    expect(
      enabled(screen.getByRole("button", { name: "Print benchy.gcode" })),
    ).toBe(false);
    expect(enabled(buttonIn("Temperatures", "Set the Nozzle"))).toBe(false);
    expect(enabled(buttonIn("Simulator", "Filament runout"))).toBe(false);
    // Uploads have a lane of their own.
    expect(enabled(buttonIn("Files", "Upload"))).toBe(true);

    act(() => {
      server.releaseCommands();
    });
    await waitFor(() => {
      expect(enabled(buttonIn("Motion", "Home all"))).toBe(true);
    });
    expect(commands(server)).toEqual([{ kind: "motion.home", axes: [] }]);
  });

  it("sends two clicks in a row once, though the page hasn't re-rendered between them", async () => {
    const { server } = await open();
    server.holdCommands = true;
    const button = buttonIn("Motion", "Home all");

    act(() => {
      button.click();
      button.click();
    });
    await settle();
    act(() => {
      server.releaseCommands();
    });

    await waitFor(() => {
      expect(enabled(buttonIn("Motion", "Home all"))).toBe(true);
    });
    expect(commands(server)).toHaveLength(1);
  });

  it("keeps the printer's commands while an upload runs, and takes one upload at a time", async () => {
    const { server, user } = await open();
    server.holdUploads = true;

    await user.upload(
      screen.getByLabelText("File to upload"),
      new File(["G28"], "a.gcode"),
    );

    const uploading = await within(card("Files")).findByRole("button", {
      name: "Uploading…",
    });
    expect(enabled(uploading)).toBe(false);
    expect(uploading.title).toBe("An upload is running.");
    expect(enabled(buttonIn("Motion", "Home all"))).toBe(true);
    expect(
      enabled(screen.getByRole("button", { name: "Print benchy.gcode" })),
    ).toBe(true);

    act(() => {
      server.releaseUploads();
    });

    expect(await screen.findByText("Uploaded a.gcode to Sim 1.")).toBeDefined();
    expect(enabled(buttonIn("Files", "Upload"))).toBe(true);
  });

  it("goes to the login page when a command finds the session gone", async () => {
    const { app, server, user } = await open();
    // The session has expired on the server.
    server.session = null;
    server.overrides.set("POST /api/printers/p1/commands", () =>
      apiError(401, "unauthenticated", "Log in first."),
    );

    await user.click(buttonIn("Motion", "Home all"));

    await heading("Log in to Open Print Stack");
    expect(location(app)).toBe("/login?redirect=%2Fprinters%2Fp1");
  });

  it("shows a failed command's reason in a toast", async () => {
    const { server, user } = await open();
    server.overrides.set("POST /api/printers/p1/commands", () =>
      apiError(
        409,
        "printer_busy",
        "Another command to this printer is still running.",
      ),
    );

    await user.click(buttonIn("Motion", "Home X"));

    expect(await screen.findByText("Couldn't home X")).toBeDefined();
    expect(
      screen.getByText("Another command to this printer is still running."),
    ).toBeDefined();
  });

  it("asks before cancelling", async () => {
    const { server, user } = await open({
      status: "printing",
      telemetry: { job: JOB },
    });

    await user.click(buttonIn("Print", "Cancel"));
    const dialog = await screen.findByRole("alertdialog");
    expect(
      within(dialog).getByText("Cancel the print of benchy.gcode?"),
    ).toBeDefined();
    expect(
      within(dialog).getByText("A cancelled job can't be resumed."),
    ).toBeDefined();
    await user.click(
      within(dialog).getByRole("button", { name: "Keep printing" }),
    );
    await settle();
    expect(commands(server)).toEqual([]);

    await user.click(buttonIn("Print", "Cancel"));
    await user.click(
      within(await screen.findByRole("alertdialog")).getByRole("button", {
        name: "Cancel the print",
      }),
    );

    await waitFor(() => {
      expect(commands(server)).toEqual([{ kind: "print.cancel" }]);
    });
  });

  it("starts a print from the files", async () => {
    const { server, user } = await open();

    await user.click(
      within(card("Files")).getByRole("button", { name: "Print benchy.gcode" }),
    );

    await waitFor(() => {
      expect(commands(server)).toEqual([
        { kind: "print.start", fileName: "benchy.gcode" },
      ]);
    });
  });
});

describe("the job", () => {
  it("shows its progress, times, layers and speed, and the printer's error", async () => {
    await open({
      status: "error",
      error: { code: "simulated", message: "Thermal runaway." },
      telemetry: { job: JOB, speedPercent: 150 },
    });

    const print = within(card("Print"));
    expect(print.getByText("Thermal runaway.")).toBeDefined();
    expect(print.getByText("benchy.gcode")).toBeDefined();
    expect(print.getByText("43 %")).toBeDefined();
    expect(print.getByText("Elapsed").nextSibling?.textContent).toBe(
      "1 h 2 min 5 s",
    );
    expect(print.getByText("Remaining").nextSibling?.textContent).toBe(
      "3 min 20 s",
    );
    expect(print.getByText("Layer").nextSibling?.textContent).toBe("12 of 240");
    expect(print.getByText("Speed").nextSibling?.textContent).toBe("150 %");
  });

  it("shows what the printer doesn't report as a dash", async () => {
    await open({
      status: "printing",
      telemetry: {
        speedPercent: null,
        job: {
          ...JOB,
          remainingS: null,
          currentLayer: null,
          totalLayers: null,
        },
      },
    });

    const print = within(card("Print"));
    expect(print.getByText("Remaining").nextSibling?.textContent).toBe("—");
    expect(print.getByText("Layer").nextSibling?.textContent).toBe("—");
    expect(print.getByText("Speed").nextSibling?.textContent).toBe("—");
  });

  it("follows the printer live", async () => {
    const { server } = await open();
    expect(within(card("Print")).getByText(/^No job/)).toBeDefined();

    server.publish("printer.telemetry", "p1", {
      telemetry: { ...IDLE_TELEMETRY, job: { ...JOB, progressPercent: 80 } },
    });

    expect(await within(card("Print")).findByText("80 %")).toBeDefined();
  });
});

describe("temperatures", () => {
  it("sets a target, and turns a heater off", async () => {
    const { server, user } = await open();

    await user.type(screen.getByLabelText("Nozzle target (°C)"), "210");
    await user.click(buttonIn("Temperatures", "Set the Nozzle"));
    await waitFor(() => {
      expect(commands(server)).toHaveLength(1);
    });
    await user.click(buttonIn("Temperatures", "Turn the Bed off"));

    await waitFor(() => {
      expect(commands(server)).toEqual([
        { kind: "temperature.set", heaterId: "nozzle", targetC: 210 },
        { kind: "temperature.set", heaterId: "bed", targetC: 0 },
      ]);
    });
  });

  it("refuses a target above the heater's maximum without sending it", async () => {
    const { server, user } = await open();

    await user.type(screen.getByLabelText("Nozzle target (°C)"), "400");
    await user.click(buttonIn("Temperatures", "Set the Nozzle"));
    await user.type(screen.getByLabelText("Bed target (°C)"), "121");
    await user.click(buttonIn("Temperatures", "Set the Bed"));

    expect(await screen.findByText("Must be at most 300 °C.")).toBeDefined();
    expect(screen.getByText("Must be at most 120 °C.")).toBeDefined();
    await settle();
    expect(commands(server)).toEqual([]);
  });

  it.each([
    ["", "Enter a temperature."],
    ["warm", "Enter a temperature."],
    ["-5", "Must be at least 0 °C."],
  ])("refuses %j", async (text, message) => {
    const { server, user } = await open();

    if (text !== "") {
      await user.type(screen.getByLabelText("Nozzle target (°C)"), text);
    }
    await user.click(buttonIn("Temperatures", "Set the Nozzle"));

    expect(await screen.findByText(message)).toBeDefined();
    expect(commands(server)).toEqual([]);
  });

  it("takes exactly the maximum", async () => {
    const { server, user } = await open();

    await user.type(screen.getByLabelText("Nozzle target (°C)"), "300");
    await user.click(buttonIn("Temperatures", "Set the Nozzle"));

    await waitFor(() => {
      expect(commands(server)).toEqual([
        { kind: "temperature.set", heaterId: "nozzle", targetC: 300 },
      ]);
    });
  });
});

describe("temperatures of sensors", () => {
  const SENSOR = {
    id: "chamber",
    kind: "chamber",
    label: "Chamber",
    controllable: false,
    maxC: null,
  } as const;

  it("shows a heater that only reports its temperature, without controls", async () => {
    await open({
      telemetry: {
        temperatures: {
          ...IDLE_TELEMETRY.temperatures,
          chamber: { actualC: 31.2, targetC: null },
        },
      },
      capabilities: {
        ...capabilitiesFixture,
        heaters: [...capabilitiesFixture.heaters, SENSOR],
      },
    });

    const temperatures = within(card("Temperatures"));
    expect(temperatures.getByText("Chamber").nextSibling?.textContent).toBe(
      "31.2 °C",
    );
    expect(temperatures.queryByLabelText("Chamber target (°C)")).toBeNull();
    expect(temperatures.queryByRole("button", { name: /Chamber/ })).toBeNull();
    expect(
      temperatures.getByRole("button", { name: "Set the Nozzle" }),
    ).toBeDefined();
  });

  it("gives no reason for controls a printer of sensors doesn't have", async () => {
    await open({
      status: "offline",
      capabilities: { ...capabilitiesFixture, heaters: [SENSOR] },
    });

    const temperatures = within(card("Temperatures"));
    expect(temperatures.getByText("Chamber")).toBeDefined();
    expect(temperatures.queryByText("The printer is offline.")).toBeNull();
  });
});

describe("filament", () => {
  /** Each slot of the unit, as its row reads. */
  function rows(unit: string): (string | null)[] {
    return within(within(card("Filament")).getByRole("region", { name: unit }))
      .getAllByRole("listitem")
      .map((row) => row.textContent);
  }

  it("shows each unit's slots: colour, contents, nozzle range and status", async () => {
    await open({ filament: filamentFixture });

    expect(rows("CANVAS 1")).toEqual([
      "Tray 1PLA · Matte Black190–230 °CActive",
      "Tray 2PETGfrom 220 °CLoaded",
      "Tray 3EmptyEmpty",
    ]);
    const [first, , empty] = within(card("Filament")).getAllByRole("listitem");
    expect(first?.querySelector("[title='#1a1a1a']")).not.toBeNull();
    expect(empty?.querySelector("[title]")).toBeNull();
  });

  it("sits after Temperatures", async () => {
    await open({ filament: filamentFixture });

    expect(
      screen
        .getAllByRole("heading", { level: 2 })
        .map((each) => each.textContent),
    ).toEqual([
      "Print",
      "Temperatures",
      "Filament",
      "Files",
      "Motion",
      "Fans",
      "Camera",
      "Simulator",
    ]);
  });

  it("is hidden when the printer doesn't report filament", async () => {
    await open();

    expect(
      screen.queryByRole("heading", { name: "Filament", level: 2 }),
    ).toBeNull();
  });

  it("says when no units are attached", async () => {
    await open({ filament: { units: [] } });

    expect(
      within(card("Filament")).getByText("No filament units attached."),
    ).toBeDefined();
  });

  it("keeps the last readout while the printer is offline, and says so", async () => {
    await open({ status: "offline", filament: filamentFixture });

    const filament = within(card("Filament"));
    expect(
      filament.getByText("Last reported before the printer disconnected."),
    ).toBeDefined();
    expect(rows("CANVAS 1")).toHaveLength(3);
  });

  it("follows the printer live", async () => {
    const { server } = await open({ filament: filamentFixture });
    const changed = structuredClone(filamentFixture);
    changed.units[0]!.slots[0]!.status = "loaded";

    server.publish("printer.filament_changed", "p1", { filament: changed });

    await waitFor(() => {
      expect(rows("CANVAS 1")[0]).toBe(
        "Tray 1PLA · Matte Black190–230 °CLoaded",
      );
    });
    server.publish("printer.filament_changed", "p1", { filament: null });
    await waitFor(() => {
      expect(
        screen.queryByRole("heading", { name: "Filament", level: 2 }),
      ).toBeNull();
    });
  });
});

describe("fans", () => {
  it("sets a fan's speed with the slider", async () => {
    const { server, user } = await open({
      telemetry: { fans: { part: { percent: 40 } } },
    });
    const slider = within(card("Fans")).getByRole("slider");
    expect(slider.getAttribute("aria-valuenow")).toBe("40");

    slider.focus();
    await user.keyboard("{ArrowRight}");

    await waitFor(() => {
      expect(commands(server)).toEqual([
        { kind: "fan.set", fanId: "part", percent: 41 },
      ]);
    });
  });
});

describe("motion", () => {
  it("homes every axis, or one", async () => {
    const { server, user } = await open();

    await user.click(buttonIn("Motion", "Home all"));
    await waitFor(() => {
      expect(commands(server)).toHaveLength(1);
    });
    await user.click(buttonIn("Motion", "Home Z"));

    await waitFor(() => {
      expect(commands(server)).toEqual([
        { kind: "motion.home", axes: [] },
        { kind: "motion.home", axes: ["z"] },
      ]);
    });
  });

  it("jogs by the chosen step", async () => {
    const { server, user } = await open();

    await user.click(buttonIn("Motion", "Move Y by 10 mm"));
    await waitFor(() => {
      expect(commands(server)).toHaveLength(1);
    });
    await user.click(
      within(card("Motion")).getByRole("radio", { name: "0.1 mm" }),
    );
    await user.click(buttonIn("Motion", "Move X by -0.1 mm"));
    await waitFor(() => {
      expect(commands(server)).toHaveLength(2);
    });
    await user.click(
      within(card("Motion")).getByRole("radio", { name: "100 mm" }),
    );
    await user.click(buttonIn("Motion", "Move Z by 100 mm"));

    await waitFor(() => {
      expect(commands(server)).toEqual([
        { kind: "motion.move", y: 10 },
        { kind: "motion.move", x: -0.1 },
        { kind: "motion.move", z: 100 },
      ]);
    });
  });

  it("won't jog until the axis is homed, then will", async () => {
    const { server, user } = await open({
      telemetry: { position: null, homedAxes: [] },
    });

    expect(within(card("Motion")).getAllByText("Unknown")).toHaveLength(3);
    const jog = buttonIn("Motion", "Move X by 10 mm");
    expect(enabled(jog)).toBe(false);
    expect(jog.title).toBe("Home X first.");
    expect(
      within(card("Motion")).getByText(
        "Jogs need their axis homed and the position known.",
      ),
    ).toBeDefined();
    expect(enabled(buttonIn("Motion", "Home all"))).toBe(true);

    server.publish("printer.telemetry", "p1", {
      telemetry: {
        ...IDLE_TELEMETRY,
        homedAxes: ["x", "y", "z"],
        position: { x: 0, y: 0, z: 0 },
      },
    });
    await waitFor(() => {
      expect(enabled(buttonIn("Motion", "Move X by 10 mm"))).toBe(true);
    });
    await user.click(buttonIn("Motion", "Move X by 10 mm"));

    await waitFor(() => {
      expect(commands(server)).toEqual([{ kind: "motion.move", x: 10 }]);
    });
  });

  it("won't jog an axis that isn't homed while the others can", async () => {
    await open({ telemetry: { homedAxes: ["x", "y"] } });

    expect(enabled(buttonIn("Motion", "Move X by 10 mm"))).toBe(true);
    expect(enabled(buttonIn("Motion", "Move Z by -10 mm"))).toBe(false);
    expect(buttonIn("Motion", "Move Z by -10 mm").title).toBe("Home Z first.");
  });
});

describe("files", () => {
  it("lists the files newest first, with their sizes", async () => {
    await open();

    const items = within(within(card("Files")).getByRole("list")).getAllByRole(
      "listitem",
    );
    expect(items.map((item) => item.querySelector("p")?.textContent)).toEqual([
      "benchy.gcode",
      "old.gcode",
    ]);
    expect(items[0]?.textContent).toContain("1.2 MB");
    expect(items[1]?.textContent).toContain("999 B");
  });

  it("doesn't ask for files or cameras while the printer is offline, and does once it's online", async () => {
    const { server } = await open({ status: "offline" });

    expect(
      within(card("Files")).getByText(
        "Files appear when the printer is online.",
      ),
    ).toBeDefined();
    expect(
      within(card("Camera")).getByText(
        "Snapshots appear when the printer is online.",
      ),
    ).toBeDefined();
    expect(server.requestsTo("GET /api/printers/p1/files")).toEqual([]);
    expect(server.requestsTo("GET /api/printers/p1/cameras")).toEqual([]);

    server.publish("printer.status_changed", "p1", {
      previous: "offline",
      status: "idle",
      detail: null,
      error: null,
    });

    expect(
      await within(card("Files")).findByText("benchy.gcode"),
    ).toBeDefined();
    expect(server.requestsTo("GET /api/printers/p1/files")).toHaveLength(1);
    expect(server.requestsTo("GET /api/printers/p1/cameras")).toHaveLength(1);
  });

  it("asks for the list again when the printer's files change", async () => {
    const { server } = await open();
    expect(server.requestsTo("GET /api/printers/p1/files")).toHaveLength(1);

    server.files.set("p1", [
      {
        name: "new.gcode",
        sizeBytes: 10,
        modifiedAt: "2026-10-07T12:00:00.000Z",
      },
    ]);
    server.publish("printer.files_changed", "p1", {});

    expect(await within(card("Files")).findByText("new.gcode")).toBeDefined();
    expect(server.requestsTo("GET /api/printers/p1/files")).toHaveLength(2);
  });

  it("uploads a file as it is, its name percent-encoded, and says so", async () => {
    const { server, user } = await open();

    await user.upload(
      screen.getByLabelText("File to upload"),
      new File(["G28\n"], "my part #2.gcode", { type: "text/x-gcode" }),
    );

    expect(
      await screen.findByText("Uploaded my part #2.gcode to Sim 1."),
    ).toBeDefined();
    expect(
      server.requestsTo("PUT /api/printers/p1/files/my%20part%20%232.gcode"),
    ).toEqual([{ contentType: "application/octet-stream", text: "G28\n" }]);
  });

  it("refuses a file of a type the printer doesn't take, without sending it", async () => {
    const { server } = await open();
    // As if "All files" were chosen in the picker.
    const user = userEvent.setup({ applyAccept: false });

    await user.upload(
      screen.getByLabelText("File to upload"),
      new File(["solid"], "part.stl"),
    );

    expect(await screen.findByText("Couldn't upload part.stl")).toBeDefined();
    expect(screen.getByText("Sim 1 only takes .gcode files.")).toBeDefined();
    expect(server.requests.filter((each) => each.method === "PUT")).toEqual([]);
  });

  it("refuses a file over the printer's limit, without sending it", async () => {
    const { server, user } = await open({
      capabilities: {
        ...capabilitiesFixture,
        files: { ...capabilitiesFixture.files, maxUploadBytes: 4 },
      },
    });

    await user.upload(
      screen.getByLabelText("File to upload"),
      new File(["G28\nG1"], "big.gcode"),
    );

    expect(
      await screen.findByText("big.gcode is 6 B; Sim 1 takes at most 4 B."),
    ).toBeDefined();
    expect(server.requests.filter((each) => each.method === "PUT")).toEqual([]);
  });

  it("shows a refused upload's reason", async () => {
    const { server, user } = await open();
    server.overrides.set("PUT /api/printers/p1/files/a.gcode", () =>
      apiError(409, "printer_offline", "The printer is offline."),
    );

    await user.upload(
      screen.getByLabelText("File to upload"),
      new File(["G28"], "a.gcode"),
    );

    expect(await screen.findByText("Couldn't upload a.gcode")).toBeDefined();
    expect(
      within(document.body).getAllByText("The printer is offline."),
    ).not.toHaveLength(0);
  });

  it("offers only the printer's file types in the picker", async () => {
    await open();

    expect(screen.getByLabelText("File to upload").getAttribute("accept")).toBe(
      ".gcode",
    );
  });
});

describe("the camera", () => {
  it("shows a snapshot, and a new one on Refresh", async () => {
    const { user } = await open();
    const image = await within(card("Camera")).findByRole("img", {
      name: "Snapshot from Simulated camera",
    });
    const first = image.getAttribute("src");
    expect(first).toMatch(
      /^\/api\/printers\/p1\/cameras\/main\/snapshot\?t=\d+$/,
    );

    await user.click(buttonIn("Camera", "Refresh"));

    const second = within(card("Camera")).getByRole("img").getAttribute("src");
    expect(second).toMatch(
      /^\/api\/printers\/p1\/cameras\/main\/snapshot\?t=\d+$/,
    );
    expect(second).not.toBe(first);
  });

  it("says when a snapshot can't be loaded, and tries again on Refresh", async () => {
    const { user } = await open();
    const image = await within(card("Camera")).findByRole("img");

    image.dispatchEvent(new Event("error"));

    expect(
      await within(card("Camera")).findByText(
        "Couldn't load the snapshot from Simulated camera.",
      ),
    ).toBeDefined();
    await user.click(buttonIn("Camera", "Refresh"));
    expect(within(card("Camera")).getByRole("img")).toBeDefined();
  });
});

describe("the Simulator panel", () => {
  function simulator(server: FakeServer, action: string): unknown[] {
    return server.requestsTo(`POST /api/printers/p1/simulator/${action}`);
  }

  it("sends each fault", async () => {
    const { server, user } = await open();

    await user.click(buttonIn("Simulator", "Filament runout"));
    await waitFor(() => {
      expect(simulator(server, "faults/filament-runout")).toHaveLength(1);
    });
    await user.click(buttonIn("Simulator", "Simulate an error"));
    await waitFor(() => {
      expect(simulator(server, "faults/error")).toHaveLength(1);
    });
    await user.type(
      screen.getByLabelText("Error message (optional)"),
      "Jammed",
    );
    await user.click(buttonIn("Simulator", "Simulate an error"));
    await waitFor(() => {
      expect(simulator(server, "faults/error")).toHaveLength(2);
    });
    await user.click(buttonIn("Simulator", "Disconnect"));
    await waitFor(() => {
      expect(simulator(server, "faults/disconnect")).toHaveLength(1);
    });
    await user.type(
      screen.getByLabelText("Speed multiplier, until the printer restarts"),
      "60",
    );
    await user.click(buttonIn("Simulator", "Set speed"));
    await waitFor(() => {
      expect(simulator(server, "speed")).toHaveLength(1);
    });
    await user.click(buttonIn("Simulator", "Clear"));

    await waitFor(() => {
      expect(simulator(server, "clear")).toHaveLength(1);
    });
    expect(simulator(server, "faults/filament-runout")).toEqual([undefined]);
    expect(simulator(server, "faults/error")).toEqual([
      {},
      { message: "Jammed" },
    ]);
    expect(simulator(server, "faults/disconnect")).toEqual([{ durationS: 15 }]);
    expect(simulator(server, "speed")).toEqual([{ multiplier: 60 }]);
    expect(simulator(server, "clear")).toEqual([undefined]);
  });

  it.each([
    ["Disconnect for (seconds)", "0", "Disconnect", "Must be from 1 to 3600."],
    [
      "Disconnect for (seconds)",
      "3601",
      "Disconnect",
      "Must be from 1 to 3600.",
    ],
    [
      "Speed multiplier, until the printer restarts",
      "",
      "Set speed",
      "Enter a multiplier.",
    ],
    [
      "Speed multiplier, until the printer restarts",
      "1001",
      "Set speed",
      "Must be from 0.1 to 1000.",
    ],
    [
      "Error message (optional)",
      "x".repeat(501),
      "Simulate an error",
      "Must be at most 500 characters.",
    ],
  ])(
    "refuses %s %j without sending it",
    async (label, text, button, message) => {
      const { server, user } = await open();

      await user.clear(screen.getByLabelText(label));
      // Pasted, not typed: typing 501 characters one at a time can take
      // longer than the 5 s a test gets on a slow CI machine.
      if (text !== "") {
        await user.click(screen.getByLabelText(label));
        await user.paste(text);
      }
      await user.click(buttonIn("Simulator", button));

      expect(await screen.findByText(message)).toBeDefined();
      expect(
        server.requests.filter((each) => each.path.includes("/simulator/")),
      ).toEqual([]);
    },
  );

  it("shares the printer's command lock", async () => {
    const { server, user } = await open();
    server.holdCommands = true;

    await user.click(buttonIn("Simulator", "Clear"));

    await waitFor(() => {
      expect(enabled(buttonIn("Motion", "Home all"))).toBe(false);
    });
    act(() => {
      server.releaseCommands();
    });
    await waitFor(() => {
      expect(enabled(buttonIn("Motion", "Home all"))).toBe(true);
    });
  });

  it("shows a refused fault's reason in a toast", async () => {
    const { server, user } = await open();
    server.overrides.set(
      "POST /api/printers/p1/simulator/faults/filament-runout",
      () =>
        apiError(
          409,
          "invalid_state",
          "The printer is idle: filament can only run out during a print.",
        ),
    );

    await user.click(buttonIn("Simulator", "Filament runout"));

    expect(
      await screen.findByText("Couldn't simulate a filament runout"),
    ).toBeDefined();
    expect(
      screen.getByText(
        "The printer is idle: filament can only run out during a print.",
      ),
    ).toBeDefined();
  });
});

describe("deleting", () => {
  it("asks first, naming the printer, then deletes and goes to the list", async () => {
    const { app, server, user } = await open();

    await user.click(screen.getByRole("button", { name: "Delete" }));
    const dialog = await screen.findByRole("alertdialog");
    expect(within(dialog).getByText("Delete Sim 1?")).toBeDefined();
    expect(
      within(dialog).getByText(
        "Its files on the server are deleted; its event history is kept.",
      ),
    ).toBeDefined();
    await user.click(within(dialog).getByRole("button", { name: "Keep it" }));
    await settle();
    expect(server.requestsTo("DELETE /api/printers/p1")).toEqual([]);

    await user.click(screen.getByRole("button", { name: "Delete" }));
    await user.click(
      within(await screen.findByRole("alertdialog")).getByRole("button", {
        name: "Delete",
      }),
    );

    await heading("Printers");
    expect(location(app)).toBe("/");
    expect(server.requestsTo("DELETE /api/printers/p1")).toHaveLength(1);
  });

  it("warns that a job can't be controlled afterwards", async () => {
    const { user } = await open({
      status: "printing",
      telemetry: { job: JOB },
    });

    await user.click(screen.getByRole("button", { name: "Delete" }));

    expect(
      within(await screen.findByRole("alertdialog")).getByText(
        "Its files on the server are deleted; its event history is kept. It's printing benchy.gcode. Deleting disconnects it, so this app can't pause or cancel that job afterwards.",
      ),
    ).toBeDefined();
  });

  it("stays, with a toast, when deleting fails", async () => {
    const { app, server, user } = await open();
    server.overrides.set("DELETE /api/printers/p1", () =>
      apiError(500, "internal", "Something went wrong on the server."),
    );

    await user.click(screen.getByRole("button", { name: "Delete" }));
    await user.click(
      within(await screen.findByRole("alertdialog")).getByRole("button", {
        name: "Delete",
      }),
    );

    expect(await screen.findByText("Couldn't delete Sim 1")).toBeDefined();
    expect(location(app)).toBe("/printers/p1");
  });
});

describe("the page", () => {
  it("says so when there's no such printer", async () => {
    const server = serverWith();
    renderApp(server, "/printers/nope");

    expect(
      await screen.findByRole("heading", { name: "No such printer" }),
    ).toBeDefined();
  });

  it("says so when the printer is deleted elsewhere", async () => {
    const { server } = await open();

    server.publish("printer.removed", "p1", { name: "Sim 1" });

    expect(
      await screen.findByRole("heading", { name: "Sim 1 is gone" }),
    ).toBeDefined();
    expect(screen.getByText("It has been deleted.")).toBeDefined();
  });

  it("shows a rename at once", async () => {
    const { server } = await open();

    server.configs.set("p1", {
      ...server.configs.get("p1")!,
      name: "Workshop",
    });
    server.printers = server.printers.map((each) => ({
      ...each,
      printer: { ...each.printer, name: "Workshop" },
    }));
    server.publish("printer.updated", "p1", { changedFields: ["name"] });

    expect(
      await screen.findByRole("heading", { name: "Workshop", level: 1 }),
    ).toBeDefined();
  });

  it("starts again from the server's state after it restarts", async () => {
    const { server } = await open({
      status: "printing",
      telemetry: { job: JOB },
    });

    server.bootId = "0199b3a0-1c00-7000-8000-00000000b002";
    server.printers = server.printers.map((each) => ({
      ...each,
      state: { ...each.state, status: "connecting", telemetry: IDLE_TELEMETRY },
    }));
    act(() => {
      server.sockets.last.serverClose(1001, "The server is shutting down.");
    });

    await waitFor(() => {
      expect(screen.getByText("Connecting")).toBeDefined();
    });
    expect(within(card("Print")).getByText(/^No job/)).toBeDefined();
  });

  it("links back to the list, and to the edit page", async () => {
    const { app, user } = await open();

    await user.click(screen.getByRole("link", { name: "Edit" }));
    await heading("Edit Sim 1");
    expect(location(app)).toBe("/printers/p1/edit");

    await user.click(screen.getByRole("link", { name: "Printers" }));
    await heading("Printers");
    expect(location(app)).toBe("/");
  });
});
