// SPDX-FileCopyrightText: 2026 Open Print Stack contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { screen, waitFor } from "@testing-library/react";
import type userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { apiError, FakeServer } from "../test/fake-server.ts";
import { SIMULATED_DEFAULTS, SIMULATED_DRIVER_TYPE } from "../test/fixtures.ts";
import { serverWith, snapshotOf } from "../test/printers.ts";
import { heading, location, renderApp } from "../test/render-app.tsx";

// Adding and editing printers: the form generated from the driver type's
// settings schema, checked before sending, and the server's answers.

type User = ReturnType<typeof userEvent.setup>;

const ADD = "Add a printer";

function field(label: string): HTMLInputElement {
  return screen.getByLabelText(label);
}

async function replace(user: User, label: string, text: string) {
  await user.clear(field(label));
  if (text !== "") await user.type(field(label), text);
}

async function submit(user: User, name: string) {
  await user.click(screen.getByRole("button", { name }));
}

describe("adding a printer", () => {
  it("shows the simulated printer's settings with their hints, at their defaults", async () => {
    renderApp(FakeServer.withUser({ loggedIn: true }), "/printers/new");
    await heading(ADD);

    expect(await screen.findByLabelText("Name")).toBeDefined();
    expect(screen.getByLabelText<HTMLSelectElement>("Printer type").value).toBe(
      "simulated",
    );
    expect(screen.getByText(SIMULATED_DRIVER_TYPE.description)).toBeDefined();
    expect(field("Print duration (s)").value).toBe("600");
    expect(field("Speed multiplier").value).toBe("1");
    expect(
      screen.getByText(
        "How fast simulated time runs. At 60, a simulated minute passes every second.",
      ),
    ).toBeDefined();
    expect(field("Build volume Z (mm)").value).toBe("256");
    expect(
      screen
        .getByRole("switch", { name: "Camera" })
        .getAttribute("aria-checked"),
    ).toBe("true");
  });

  it("adds a simulated printer at ×60 and opens its page", async () => {
    const server = FakeServer.withUser({ loggedIn: true });
    const { app, user } = renderApp(server, "/printers/new");
    await heading(ADD);

    await user.type(await screen.findByLabelText("Name"), "  Sim 1 ");
    await replace(user, "Speed multiplier", "60");
    await user.click(screen.getByRole("switch", { name: "Camera" }));
    await submit(user, "Add printer");

    await heading("Sim 1");
    expect(location(app)).toBe("/printers/printer-1");
    expect(server.requestsTo("POST /api/printers")).toEqual([
      {
        name: "Sim 1",
        driverType: "simulated",
        settings: {
          ...SIMULATED_DEFAULTS,
          speedMultiplier: 60,
          cameraEnabled: false,
        },
      },
    ]);
  });

  it("checks the name and settings before sending", async () => {
    const server = FakeServer.withUser({ loggedIn: true });
    const { user } = renderApp(server, "/printers/new");
    await heading(ADD);
    await screen.findByLabelText("Name");

    await user.type(field("Name"), "   ");
    await replace(user, "Speed multiplier", "0");
    await replace(user, "Print duration (s)", "1.5");
    await replace(user, "Heat-up time (s)", "");
    await replace(user, "Nozzle maximum (°C)", "hot");
    await submit(user, "Add printer");

    expect(await screen.findByText("Must not be empty.")).toBeDefined();
    expect(screen.getByText("Must be at least 0.1.")).toBeDefined();
    expect(screen.getByText("Must be a whole number.")).toBeDefined();
    expect(screen.getByText("Enter a number.")).toBeDefined();
    expect(field("Speed multiplier").getAttribute("aria-invalid")).toBe("true");
    // Empty, so optional (it has a default): no error.
    expect(field("Heat-up time (s)").getAttribute("aria-invalid")).toBe(
      "false",
    );
    expect(server.requestsTo("POST /api/printers")).toEqual([]);
  });

  it("leaves out an optional setting left empty", async () => {
    const server = FakeServer.withUser({ loggedIn: true });
    const { user } = renderApp(server, "/printers/new");
    await heading(ADD);
    await user.type(await screen.findByLabelText("Name"), "Sim 1");

    await replace(user, "Heat-up time (s)", "");
    await submit(user, "Add printer");

    await heading("Sim 1");
    const [sent] = server.requestsTo("POST /api/printers") as {
      settings: Record<string, unknown>;
    }[];
    expect(sent?.settings).not.toHaveProperty("heatUpS");
  });

  it("puts a taken name on the name field, and clears it as you type", async () => {
    const server = FakeServer.withUser({ loggedIn: true });
    server.addPrinter(snapshotOf({ name: "Bench" }));
    const { user } = renderApp(server, "/printers/new");
    await heading(ADD);

    await user.type(await screen.findByLabelText("Name"), "bench");
    await submit(user, "Add printer");

    expect(
      await screen.findByText("Another printer already has that name."),
    ).toBeDefined();
    expect(field("Name").getAttribute("aria-invalid")).toBe("true");

    await user.type(field("Name"), " 2");

    expect(
      screen.queryByText("Another printer already has that name."),
    ).toBeNull();
  });

  it("puts the server's settings issues on their fields, and the rest under the form", async () => {
    const server = FakeServer.withUser({ loggedIn: true });
    server.overrides.set("POST /api/printers", () =>
      Response.json(
        {
          error: {
            code: "invalid_settings",
            message: "The settings aren't valid. ✖ Too big",
            details: [
              {
                path: ["bedMaxC"],
                message: "Too big: expected number to be <=200",
              },
              { path: [], message: "Unrecognized key: extra" },
            ],
          },
        },
        { status: 422 },
      ),
    );
    const { user } = renderApp(server, "/printers/new");
    await heading(ADD);

    await user.type(await screen.findByLabelText("Name"), "Sim 1");
    await submit(user, "Add printer");

    expect(
      await screen.findByText("Too big: expected number to be <=200"),
    ).toBeDefined();
    expect(field("Bed maximum (°C)").getAttribute("aria-invalid")).toBe("true");
    expect(
      screen.getByText("The settings aren't valid. ✖ Too big"),
    ).toBeDefined();
  });

  it("says so when the server can't be reached", async () => {
    const server = FakeServer.withUser({ loggedIn: true });
    const { user } = renderApp(server, "/printers/new");
    await heading(ADD);
    await user.type(await screen.findByLabelText("Name"), "Sim 1");

    server.mode = "network";
    await submit(user, "Add printer");

    expect(
      await screen.findByText(
        "Can't reach the server. Check that it's running, then try again.",
      ),
    ).toBeDefined();
  });

  it("explains a printer type whose settings the form can't show, and won't add it", async () => {
    const server = FakeServer.withUser({ loggedIn: true });
    server.driverTypes = [
      {
        ...SIMULATED_DRIVER_TYPE,
        settingsSchema: {
          type: "object",
          properties: { host: { type: "string", format: "hostname" } },
        },
      },
    ];
    renderApp(server, "/printers/new");
    await heading(ADD);

    expect(
      await screen.findByText(
        `This printer type's settings can't be shown. The setting "host" uses "format", which the form doesn't support yet.`,
      ),
    ).toBeDefined();
    expect(
      screen.getByRole<HTMLButtonElement>("button", { name: "Add printer" })
        .disabled,
    ).toBe(true);
  });

  it("changes the settings with the printer type", async () => {
    const server = FakeServer.withUser({ loggedIn: true });
    server.driverTypes = [
      SIMULATED_DRIVER_TYPE,
      {
        type: "networked",
        name: "Networked printer",
        description: "One on the network.",
        settingsSchema: {
          type: "object",
          properties: {
            host: { type: "string", title: "Address", minLength: 1 },
            mode: { type: "string", enum: ["lan", "cloud"], default: "lan" },
          },
          required: ["host"],
        },
        defaults: { mode: "lan" },
      },
    ];
    const { user } = renderApp(server, "/printers/new");
    await heading(ADD);
    await user.type(await screen.findByLabelText("Name"), "Lab");

    await user.selectOptions(
      screen.getByLabelText("Printer type"),
      "networked",
    );
    expect(screen.queryByLabelText("Speed multiplier")).toBeNull();
    expect(screen.getByText("One on the network.")).toBeDefined();
    await submit(user, "Add printer");
    expect(await screen.findByText("Enter a value.")).toBeDefined();

    await user.type(field("Address"), "printer.local");
    await user.selectOptions(screen.getByLabelText("mode"), "cloud");
    await submit(user, "Add printer");

    await heading("Lab");
    expect(server.requestsTo("POST /api/printers")).toEqual([
      {
        name: "Lab",
        driverType: "networked",
        settings: { host: "printer.local", mode: "cloud" },
      },
    ]);
  });

  it("offers to try again when the printer types can't be loaded", async () => {
    const server = FakeServer.withUser({ loggedIn: true });
    server.overrides.set("GET /api/driver-types", () =>
      apiError(500, "internal", "Something went wrong on the server."),
    );
    const { user } = renderApp(server, "/printers/new");

    expect(
      await screen.findByText(
        "Couldn't load the printer types: Something went wrong on the server.",
      ),
    ).toBeDefined();
    server.overrides.delete("GET /api/driver-types");
    await user.click(screen.getByRole("button", { name: "Try again" }));

    expect(await screen.findByLabelText("Speed multiplier")).toBeDefined();
  });
});

describe("editing a printer", () => {
  const EDIT = "Edit Sim 1";

  function editing(status: Parameters<typeof snapshotOf>[0] = {}) {
    const server = serverWith(status);
    server.configs.set("p1", {
      ...server.configs.get("p1")!,
      settings: { ...SIMULATED_DEFAULTS, speedMultiplier: 60 },
    });
    return server;
  }

  it("starts from the stored config, with the type as text", async () => {
    renderApp(editing(), "/printers/p1/edit");
    await heading(EDIT);

    expect(
      await screen.findByLabelText<HTMLInputElement>("Name"),
    ).toHaveProperty("value", "Sim 1");
    expect(field("Speed multiplier").value).toBe("60");
    expect(screen.getByText("Simulated printer").tagName).toBe("P");
    expect(screen.queryByRole("combobox", { name: "Printer type" })).toBeNull();
  });

  it("renames without sending the settings, and goes back to the printer's page", async () => {
    const server = editing();
    const { app, user } = renderApp(server, "/printers/p1/edit");
    await heading(EDIT);

    await replace(user, "Name", "Workshop");
    await submit(user, "Save");

    await heading("Print");
    expect(location(app)).toBe("/printers/p1");
    expect(server.requestsTo("PATCH /api/printers/p1")).toEqual([
      { name: "Workshop" },
    ]);
  });

  it("sends only the settings that changed", async () => {
    const server = editing();
    const { user } = renderApp(server, "/printers/p1/edit");
    await heading(EDIT);

    await replace(user, "Speed multiplier", "2");
    await replace(user, "Print duration (s)", "600.0");
    await submit(user, "Save");

    await heading("Print");
    expect(server.requestsTo("PATCH /api/printers/p1")).toEqual([
      { settings: { speedMultiplier: 2 } },
    ]);
  });

  it("sends nothing when nothing changed", async () => {
    const server = editing();
    const { app, user } = renderApp(server, "/printers/p1/edit");
    await heading(EDIT);
    await screen.findByLabelText("Name");

    await submit(user, "Save");

    await heading("Print");
    expect(location(app)).toBe("/printers/p1");
    expect(server.requestsTo("PATCH /api/printers/p1")).toEqual([]);
  });

  it.each([
    "preparing",
    "printing",
    "pausing",
    "paused",
    "cancelling",
  ] as const)(
    "locks the settings while %s, and still renames",
    async (status) => {
      const server = editing({ status });
      const { user } = renderApp(server, "/printers/p1/edit");
      await heading(EDIT);

      expect(
        await screen.findByText(
          "Settings can't change during a job. You can still rename the printer.",
        ),
      ).toBeDefined();
      expect(field("Speed multiplier").disabled).toBe(true);
      expect(
        screen.getByRole<HTMLButtonElement>("switch", { name: "Camera" })
          .disabled,
      ).toBe(true);
      await replace(user, "Name", "Workshop");
      await submit(user, "Save");

      await heading("Print");
      expect(server.requestsTo("PATCH /api/printers/p1")).toEqual([
        { name: "Workshop" },
      ]);
    },
  );

  it.each(["idle", "error", "offline"] as const)(
    "doesn't lock the settings while %s",
    async (status) => {
      renderApp(editing({ status }), "/printers/p1/edit");
      await heading(EDIT);

      expect(
        await screen.findByLabelText<HTMLInputElement>("Speed multiplier"),
      ).toHaveProperty("disabled", false);
      expect(screen.queryByText(/Settings can't change/)).toBeNull();
    },
  );

  it("locks the settings when a job starts while editing", async () => {
    const server = editing();
    renderApp(server, "/printers/p1/edit");
    await heading(EDIT);
    await screen.findByLabelText("Speed multiplier");

    server.publish("printer.status_changed", "p1", {
      previous: "idle",
      status: "preparing",
      detail: "Heating up",
      error: null,
    });

    await waitFor(() => {
      expect(field("Speed multiplier").disabled).toBe(true);
    });
  });

  it("shows the server's refusal when a job started before the save arrived", async () => {
    const server = editing();
    server.overrides.set("PATCH /api/printers/p1", () =>
      apiError(
        409,
        "job_active",
        "The settings can't change while the printer is printing.",
      ),
    );
    const { app, user } = renderApp(server, "/printers/p1/edit");
    await heading(EDIT);

    await replace(user, "Speed multiplier", "2");
    await submit(user, "Save");

    expect(
      await screen.findByText(
        "The settings can't change while the printer is printing.",
      ),
    ).toBeDefined();
    expect(location(app)).toBe("/printers/p1/edit");
  });

  it("puts a taken name on the name field", async () => {
    const server = editing();
    server.addPrinter(snapshotOf({ id: "p2", name: "Bench" }));
    const { user } = renderApp(server, "/printers/p1/edit");
    await heading(EDIT);

    await replace(user, "Name", "BENCH");
    await submit(user, "Save");

    expect(
      await screen.findByText("Another printer already has that name."),
    ).toBeDefined();
    expect(field("Name").getAttribute("aria-invalid")).toBe("true");
  });

  it("says so when there's no such printer", async () => {
    renderApp(FakeServer.withUser({ loggedIn: true }), "/printers/nope/edit");

    expect(
      await screen.findByText(
        "Couldn't load the printer: There is no printer nope.",
      ),
    ).toBeDefined();
  });
});
