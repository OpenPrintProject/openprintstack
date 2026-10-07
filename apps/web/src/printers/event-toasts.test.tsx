// SPDX-FileCopyrightText: 2026 Open Print Stack contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { OpsEvent } from "@openprintstack/protocol";
import { eventFixtures } from "@openprintstack/protocol/fixtures";
import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { serverWith, snapshotOf } from "../test/printers.ts";
import { heading, renderApp, settle } from "../test/render-app.tsx";
import { eventToast, restartingAfter } from "./event-toasts.tsx";

// Toasts for what happens to printers, wherever you are behind the login.

function statusChange(
  previous: OpsEvent & { type: "printer.status_changed" },
  changes: Partial<(OpsEvent & { type: "printer.status_changed" })["payload"]>,
): OpsEvent {
  return { ...previous, payload: { ...previous.payload, ...changes } };
}

describe("eventToast", () => {
  const status = eventFixtures["printer.status_changed"];

  it.each([
    [
      "an alert, by its severity",
      eventFixtures["printer.alert"],
      {
        kind: "warning",
        title: "Alert from Sim 1",
        description: "Filament ran out. The print is paused.",
      },
    ],
    [
      "a finished job",
      {
        ...eventFixtures["printer.job_ended"],
        payload: { outcome: "completed", fileName: "benchy.gcode" },
      },
      { kind: "success", title: "Sim 1 finished benchy.gcode." },
    ],
    [
      "a cancelled job",
      {
        ...eventFixtures["printer.job_ended"],
        payload: { outcome: "cancelled", fileName: "benchy.gcode" },
      },
      { kind: "info", title: "Sim 1: benchy.gcode was cancelled." },
    ],
    [
      "a failed job",
      {
        ...eventFixtures["printer.job_ended"],
        payload: { outcome: "failed", fileName: "benchy.gcode" },
      },
      { kind: "error", title: "Sim 1: benchy.gcode failed." },
    ],
    [
      "an error, with its message",
      status,
      {
        kind: "error",
        title: "Sim 1 has an error.",
        description: "Nozzle heater failed.",
      },
    ],
    [
      "an error without one, with the detail",
      statusChange(status, { error: null }),
      {
        kind: "error",
        title: "Sim 1 has an error.",
        description: "Thermal runaway",
      },
    ],
    [
      "going offline",
      statusChange(status, {
        status: "offline",
        detail: "Connection lost.",
        error: null,
      }),
      {
        kind: "warning",
        title: "Sim 1 is offline.",
        description: "Connection lost.",
      },
    ],
    [
      "going offline, without a detail",
      statusChange(status, { status: "offline", detail: null, error: null }),
      { kind: "warning", title: "Sim 1 is offline." },
    ],
  ] as const)("toasts %s", (_, event, expected) => {
    expect(eventToast(event as OpsEvent, "Sim 1")).toEqual(expected);
  });

  it.each([
    ["staying in error", statusChange(status, { previous: "error" })],
    [
      "staying offline",
      statusChange(status, { previous: "offline", status: "offline" }),
    ],
    ["going idle", statusChange(status, { status: "idle", error: null })],
    ["connecting", statusChange(status, { status: "connecting", error: null })],
    ["telemetry", eventFixtures["printer.telemetry"]],
    ["a started job", eventFixtures["printer.job_started"]],
    ["changed files", eventFixtures["printer.files_changed"]],
    ["a command's result", eventFixtures["command.result"]],
  ] as const)("doesn't toast %s", (_, event) => {
    expect(eventToast(event, "Sim 1")).toBeNull();
  });
});

describe("restarts", () => {
  const status = eventFixtures["printer.status_changed"];
  const offline = statusChange(status, {
    previous: "idle",
    status: "offline",
    detail: null,
    error: null,
  });
  const settingsChanged: OpsEvent = {
    ...eventFixtures["printer.updated"],
    payload: { changedFields: ["settings"] },
  };

  it("doesn't toast the offline of a restart", () => {
    expect(eventToast(offline, "Sim 1", true)).toBeNull();
    expect(eventToast(status, "Sim 1", true)).toEqual({
      kind: "error",
      title: "Sim 1 has an error.",
      description: "Nozzle heater failed.",
    });
  });

  it("counts only the status change right after a settings change as the restart's", () => {
    const afterUpdate = restartingAfter(new Set(), settingsChanged);
    expect([...afterUpdate]).toEqual(["printer-1"]);

    const afterStop = restartingAfter(afterUpdate, offline);
    expect([...afterStop]).toEqual([]);
  });

  it("doesn't count a rename as a restart", () => {
    const renamed: OpsEvent = {
      ...eventFixtures["printer.updated"],
      payload: { changedFields: ["name"] },
    };

    expect([...restartingAfter(new Set(), renamed)]).toEqual([]);
  });

  it("forgets a deleted printer", () => {
    expect([
      ...restartingAfter(
        new Set(["printer-1"]),
        eventFixtures["printer.removed"],
      ),
    ]).toEqual([]);
  });
});

describe("event toasts in the app", () => {
  it("toasts a printer's alert on the list, naming it", async () => {
    const server = serverWith();
    renderApp(server, "/");
    await heading("Sim 1");
    await settle();

    server.publish("printer.alert", "p1", {
      severity: "warning",
      code: "filament_runout",
      message: "Filament ran out, so the print paused.",
    });

    expect(await screen.findByText("Alert from Sim 1")).toBeDefined();
    expect(
      screen.getByText("Filament ran out, so the print paused."),
    ).toBeDefined();
  });

  it("toasts once on a printer's page, though the event comes on two topics", async () => {
    const server = serverWith();
    renderApp(server, "/printers/p1");
    await heading("Print");
    await settle();
    expect(server.sockets.last.topics().toSorted()).toEqual([
      JSON.stringify({ name: "fleet" }),
      JSON.stringify({ name: "printer", printerId: "p1" }),
    ]);

    server.publish("printer.job_ended", "p1", {
      outcome: "completed",
      fileName: "benchy.gcode",
    });

    expect(
      await screen.findByText("Sim 1 finished benchy.gcode."),
    ).toBeDefined();
    await settle();
    expect(screen.getAllByText("Sim 1 finished benchy.gcode.")).toHaveLength(1);
  });

  it("toasts on pages that don't show the printer, too", async () => {
    const server = serverWith();
    server.addPrinter(snapshotOf({ id: "p2", name: "Sim 2" }));
    renderApp(server, "/printers/p1/edit");
    await heading("Edit Sim 1");
    await settle();

    server.publish("printer.status_changed", "p2", {
      previous: "idle",
      status: "offline",
      detail: null,
      error: null,
    });

    expect(await screen.findByText("Sim 2 is offline.")).toBeDefined();
  });

  it("doesn't toast a settings restart's offline, but does a failure to come back", async () => {
    const server = serverWith();
    renderApp(server, "/");
    await heading("Sim 1");
    await settle();

    server.publish("printer.updated", "p1", { changedFields: ["settings"] });
    server.publish("printer.status_changed", "p1", {
      previous: "idle",
      status: "offline",
      detail: null,
      error: null,
    });
    server.publish("printer.status_changed", "p1", {
      previous: "offline",
      status: "connecting",
      detail: null,
      error: null,
    });
    await settle();
    expect(screen.queryByText("Sim 1 is offline.")).toBeNull();

    server.publish("printer.status_changed", "p1", {
      previous: "connecting",
      status: "offline",
      detail: "Connection refused.",
      error: null,
    });

    const toast = (await screen.findByText("Sim 1 is offline.")).closest("li");
    expect(toast?.textContent).toContain("Connection refused.");
  });

  it("doesn't toast what was already so when the page opened", async () => {
    const server = serverWith({
      status: "error",
      error: { code: "simulated", message: "Simulated error." },
    });
    renderApp(server, "/");
    await heading("Sim 1");
    await settle();

    expect(screen.queryByText("Sim 1 has an error.")).toBeNull();
  });
});
