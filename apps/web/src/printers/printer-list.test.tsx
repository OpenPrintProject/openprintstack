// SPDX-FileCopyrightText: 2026 Open Print Stack contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { capabilitiesFixture } from "@openprintstack/protocol/fixtures";
import { screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { FakeServer } from "../test/fake-server.ts";
import { IDLE_TELEMETRY, snapshotOf } from "../test/printers.ts";
import { heading, location, renderApp, settle } from "../test/render-app.tsx";

// The home page: every printer, live.

const PRINTERS = "Printers";

function listItem(name: string): HTMLElement {
  const title = screen.getByRole("heading", { name, level: 2 });
  const item = title.closest("li");
  if (item === null) throw new Error(`${name} isn't in the list.`);
  return item;
}

describe("the printer list", () => {
  it("shows each printer by name, with its status, job and nozzle and bed temperatures", async () => {
    const server = FakeServer.withUser({ loggedIn: true });
    server.addPrinter(
      snapshotOf({
        id: "p10",
        name: "Sim 10",
        status: "preparing",
        statusDetail: "Heating up",
        capabilities: {
          ...capabilitiesFixture,
          heaters: [
            ...capabilitiesFixture.heaters,
            { id: "chamber", kind: "chamber", label: "Chamber", maxC: 60 },
          ],
        },
        telemetry: {
          temperatures: {
            nozzle: { actualC: 180.04, targetC: 215 },
            bed: { actualC: 59.8, targetC: 60 },
            chamber: { actualC: 30, targetC: null },
          },
          job: {
            fileName: "benchy.gcode",
            progressPercent: 42.5,
            elapsedS: 255,
            remainingS: null,
            currentLayer: null,
            totalLayers: null,
          },
        },
      }),
    );
    server.addPrinter(snapshotOf({ id: "p2", name: "Sim 2" }));
    renderApp(server, "/");
    await heading(PRINTERS);

    await waitFor(() => {
      expect(
        screen
          .getAllByRole("heading", { level: 2 })
          .map((each) => each.textContent),
      ).toEqual(["Sim 2", "Sim 10"]);
    });
    const busy = within(listItem("Sim 10"));
    expect(busy.getByText("Preparing")).toBeDefined();
    expect(busy.getByText("Heating up")).toBeDefined();
    expect(busy.getByText("benchy.gcode")).toBeDefined();
    expect(busy.getByText("43 %")).toBeDefined();
    expect(busy.getByRole("progressbar")).toBeDefined();
    expect(busy.getByText("Nozzle").nextSibling?.textContent).toBe(
      "180 °C / 215 °C",
    );
    expect(busy.getByText("Bed").nextSibling?.textContent).toBe(
      "59.8 °C / 60 °C",
    );
    expect(busy.queryByText("Chamber")).toBeNull();
    const idle = within(listItem("Sim 2"));
    expect(idle.getByText("Idle")).toBeDefined();
    expect(idle.getByText("Nozzle").nextSibling?.textContent).toBe(
      "24.5 °C / off",
    );
    expect(idle.queryByRole("progressbar")).toBeNull();
  });

  it("shows readings the printer doesn't report as a dash, never 0, and no bar without progress", async () => {
    const server = FakeServer.withUser({ loggedIn: true });
    server.addPrinter(
      snapshotOf({
        status: "printing",
        telemetry: {
          temperatures: { nozzle: { actualC: null, targetC: null } },
          job: {
            fileName: "part.gcode",
            progressPercent: null,
            elapsedS: null,
            remainingS: null,
            currentLayer: null,
            totalLayers: null,
          },
        },
      }),
    );
    renderApp(server, "/");
    await heading("Sim 1");

    const item = within(listItem("Sim 1"));
    expect(item.getByText("Nozzle").nextSibling?.textContent).toBe("—");
    expect(item.getByText("Bed").nextSibling?.textContent).toBe("—");
    expect(item.getByText("part.gcode").nextSibling?.textContent).toBe("—");
    expect(item.queryByRole("progressbar")).toBeNull();
  });

  it("shows no temperatures before the printer reports its capabilities", async () => {
    const server = FakeServer.withUser({ loggedIn: true });
    server.addPrinter(snapshotOf({ status: "connecting", capabilities: null }));
    renderApp(server, "/");
    await heading("Sim 1");

    expect(within(listItem("Sim 1")).getByText("Connecting")).toBeDefined();
    expect(within(listItem("Sim 1")).queryByText("Nozzle")).toBeNull();
  });

  it("follows the printers live", async () => {
    const server = FakeServer.withUser({ loggedIn: true });
    server.addPrinter(snapshotOf());
    renderApp(server, "/");
    await heading("Sim 1");
    await settle();

    server.publish("printer.telemetry", "p1", {
      telemetry: {
        ...IDLE_TELEMETRY,
        temperatures: {
          nozzle: { actualC: 100.2, targetC: 210 },
          bed: { actualC: 40, targetC: 60 },
        },
      },
    });
    server.publish("printer.status_changed", "p1", {
      previous: "idle",
      status: "error",
      detail: null,
      error: { code: "simulated", message: "Simulated error." },
    });

    await waitFor(() => {
      expect(within(listItem("Sim 1")).getByText("Error")).toBeDefined();
    });
    expect(
      within(listItem("Sim 1")).getByText("Nozzle").nextSibling?.textContent,
    ).toBe("100.2 °C / 210 °C");
  });

  it("opens a printer's page from its card", async () => {
    const server = FakeServer.withUser({ loggedIn: true });
    server.addPrinter(snapshotOf());
    const { app, user } = renderApp(server, "/");
    await heading("Sim 1");

    await user.click(screen.getByRole("link", { name: "Sim 1" }));

    await heading("Print");
    expect(location(app)).toBe("/printers/p1");
  });

  it("has a way to add a printer, also when there are none", async () => {
    const server = FakeServer.withUser({ loggedIn: true });
    const { app, user } = renderApp(server, "/");
    await heading(PRINTERS);
    expect(await screen.findByText("No printers yet.")).toBeDefined();

    await user.click(screen.getByRole("link", { name: "Add printer" }));

    await heading("Add a printer");
    expect(location(app)).toBe("/printers/new");
  });
});
