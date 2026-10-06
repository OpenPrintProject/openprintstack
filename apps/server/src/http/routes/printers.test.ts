// SPDX-FileCopyrightText: 2026 Open Print Stack contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { PrinterSnapshot } from "@openprintstack/protocol";
import { describe, expect, it, vi } from "vitest";

import { TEST_DRIVER_TYPE } from "../../drivers/test-driver.ts";
import { jsonLines } from "../../test-utils.ts";
import { apiError, testApp } from "../test-app.ts";

type Config = {
  id: string;
  name: string;
  driverType: string;
  settings: Record<string, unknown>;
  settingsVersion: number;
  createdAt: string;
  updatedAt: string;
};

async function json<T>(response: Response): Promise<T> {
  return (await response.json()) as T;
}

describe("GET /api/driver-types", () => {
  it("lists each driver type with its settings schema and defaults", async () => {
    const t = await testApp();
    const { token } = await t.setupAdmin();

    const answer = await t.call("GET", "/api/driver-types", { token });

    expect(answer.status).toBe(200);
    const { driverTypes } = await json<{
      driverTypes: {
        type: string;
        name: string;
        description: string;
        settingsSchema: Record<string, unknown>;
        defaults: Record<string, unknown>;
      }[];
    }>(answer);
    expect(driverTypes.map((type) => type.type)).toEqual([
      TEST_DRIVER_TYPE,
      "simulated",
    ]);
    expect(driverTypes[0]).toEqual({
      type: TEST_DRIVER_TYPE,
      name: "Test printer",
      description: "A driver that does what the test tells it.",
      settingsSchema: expect.objectContaining({
        type: "object",
        properties: expect.objectContaining({
          nozzleMaxC: expect.objectContaining({ default: 250 }) as unknown,
        }) as unknown,
      }) as unknown,
      defaults: { nozzleMaxC: 250, failCreate: false },
    });
    expect(driverTypes[1]).toMatchObject({
      name: "Simulated printer",
      defaults: { printDurationS: 600, speedMultiplier: 1 },
      settingsSchema: {
        properties: { printDurationS: { title: "Print duration (s)" } },
      },
    });
  });

  it("leaves out a driver type that can't load, and logs it", async () => {
    const t = await testApp();
    const { token } = await t.setupAdmin();
    const load = t.deps.registry.load.bind(t.deps.registry);
    vi.spyOn(t.deps.registry, "load").mockImplementation((type) =>
      type === "simulated" ? Promise.reject(new Error("broken")) : load(type),
    );

    const answer = await t.call("GET", "/api/driver-types", { token });

    const { driverTypes } = await json<{ driverTypes: { type: string }[] }>(
      answer,
    );
    expect(driverTypes.map((type) => type.type)).toEqual([TEST_DRIVER_TYPE]);
    expect(jsonLines(t.logs)).toContainEqual(
      expect.objectContaining({
        level: "error",
        driverType: "simulated",
        msg: "A driver type couldn't load",
      }),
    );
  });
});

describe("POST /api/printers", () => {
  it("adds the printer with every default filled in, and answers 201 with its config", async () => {
    const t = await testApp();
    const { token, user } = await t.setupAdmin();

    const answer = await t.call("POST", "/api/printers", {
      token,
      json: {
        name: "Bench",
        driverType: TEST_DRIVER_TYPE,
        settings: { nozzleMaxC: 280 },
      },
    });

    expect(answer.status).toBe(201);
    const config = await json<Config>(answer);
    expect(config).toEqual({
      id: expect.any(String) as unknown,
      name: "Bench",
      driverType: TEST_DRIVER_TYPE,
      settings: { nozzleMaxC: 280, failCreate: false },
      settingsVersion: 1,
      createdAt: expect.any(String) as unknown,
      updatedAt: config.createdAt,
    });
    expect(
      t.events.find((event) => event.type === "printer.added"),
    ).toMatchObject({
      printerId: config.id,
      source: { kind: "user", userId: user.id },
      payload: { name: "Bench", driverType: TEST_DRIVER_TYPE },
    });
    // The driver started before the answer.
    expect(t.store.get(config.id)?.state.status).toBe("idle");
  });

  it("takes every default when settings are left out", async () => {
    const t = await testApp();
    const { token } = await t.setupAdmin();

    const answer = await t.call("POST", "/api/printers", {
      token,
      json: { name: "Bench", driverType: TEST_DRIVER_TYPE },
    });

    expect((await json<Config>(answer)).settings).toEqual({
      nozzleMaxC: 250,
      failCreate: false,
    });
  });

  it("trims and NFC-normalises the name", async () => {
    const t = await testApp();
    const { token } = await t.setupAdmin();

    const id = await t.addPrinter(token, "  Café – Werkstatt  ");

    expect(t.repos.printers.findById(id)?.name).toBe("Café – Werkstatt");
  });

  it.each([
    ["empty", ""],
    ["only spaces", "   "],
    ["65 characters", "x".repeat(65)],
    ["a control character", "Bench\u0007"],
    ["a newline", "Bench\nTwo"],
  ])("refuses a name that's %s", async (_, name) => {
    const t = await testApp();
    const { token } = await t.setupAdmin();

    const answer = await t.call("POST", "/api/printers", {
      token,
      json: { name, driverType: TEST_DRIVER_TYPE },
    });

    expect(answer.status).toBe(400);
    expect(await apiError(answer)).toMatchObject({
      code: "validation_failed",
      details: [{ path: ["name"] }],
    });
    expect(t.repos.printers.list()).toEqual([]);
  });

  it("accepts 64 characters, counting code points", async () => {
    const t = await testApp();
    const { token } = await t.setupAdmin();

    await t.addPrinter(token, "🖨".repeat(64));

    expect(t.repos.printers.list()).toHaveLength(1);
  });

  it("answers a name that's taken, in any case, with 409 name_taken", async () => {
    const t = await testApp();
    const { token } = await t.setupAdmin();
    await t.addPrinter(token, "Bench");

    const answer = await t.call("POST", "/api/printers", {
      token,
      json: { name: "BENCH", driverType: TEST_DRIVER_TYPE },
    });

    expect(answer.status).toBe(409);
    expect(await apiError(answer)).toEqual({
      code: "name_taken",
      message: "Another printer already has that name.",
    });
  });

  it("answers an unknown driver type with 422", async () => {
    const t = await testApp();
    const { token } = await t.setupAdmin();

    const answer = await t.call("POST", "/api/printers", {
      token,
      json: { name: "Bench", driverType: "klipper" },
    });

    expect(answer.status).toBe(422);
    expect(await apiError(answer)).toEqual({
      code: "unknown_driver_type",
      message: 'There is no driver type "klipper".',
    });
  });

  it("answers invalid settings with 422 and Zod's issues", async () => {
    const t = await testApp();
    const { token } = await t.setupAdmin();

    const answer = await t.call("POST", "/api/printers", {
      token,
      json: {
        name: "Bench",
        driverType: TEST_DRIVER_TYPE,
        settings: { nozzleMaxC: -5 },
      },
    });

    expect(answer.status).toBe(422);
    const error = await apiError(answer);
    expect(error.code).toBe("invalid_settings");
    expect(error.details).toEqual([
      expect.objectContaining({ path: ["nozzleMaxC"], code: "too_small" }),
    ]);
  });
});

describe("GET /api/printers", () => {
  it("lists every printer's snapshot, by name", async () => {
    const t = await testApp();
    const { token } = await t.setupAdmin();
    const zebra = await t.addPrinter(token, "zebra");
    const alpha = await t.addPrinter(token, "Alpha");

    const answer = await t.call("GET", "/api/printers", { token });

    const { printers } = await json<{ printers: unknown[] }>(answer);
    expect(printers).toEqual([t.store.get(alpha), t.store.get(zebra)]);
    for (const printer of printers) {
      expect(PrinterSnapshot.safeParse(printer).success).toBe(true);
    }
    // Settings never reach a snapshot.
    expect(JSON.stringify(printers)).not.toContain("nozzleMaxC");
  });

  it("is empty with no printers", async () => {
    const t = await testApp();
    const { token } = await t.setupAdmin();

    const answer = await t.call("GET", "/api/printers", { token });

    expect(await answer.json()).toEqual({ printers: [] });
  });
});

describe("GET /api/printers/{id} and /config", () => {
  it("answers the snapshot, and the config separately", async () => {
    const t = await testApp();
    const { token } = await t.setupAdmin();
    const id = await t.addPrinter(token, "Bench", { nozzleMaxC: 260 });

    const snapshot = await t.call("GET", `/api/printers/${id}`, { token });
    const config = await t.call("GET", `/api/printers/${id}/config`, { token });

    expect(await snapshot.json()).toEqual(t.store.get(id));
    expect(await config.json()).toEqual({
      id,
      name: "Bench",
      driverType: TEST_DRIVER_TYPE,
      settings: { nozzleMaxC: 260, failCreate: false },
      settingsVersion: 1,
      createdAt: new Date(
        t.repos.printers.findById(id)?.createdAt ?? 0,
      ).toISOString(),
      updatedAt: new Date(
        t.repos.printers.findById(id)?.updatedAt ?? 0,
      ).toISOString(),
    });
  });

  it.each(["", "/config"])(
    "answers an unknown printer%s with 404",
    async (suffix) => {
      const t = await testApp();
      const { token } = await t.setupAdmin();

      const answer = await t.call("GET", `/api/printers/nope${suffix}`, {
        token,
      });

      expect(answer.status).toBe(404);
      expect(await apiError(answer)).toEqual({
        code: "printer_not_found",
        message: "There is no printer nope.",
      });
    },
  );
});

describe("PATCH /api/printers/{id}", () => {
  it("renames without restarting", async () => {
    const t = await testApp();
    const { token } = await t.setupAdmin();
    const id = await t.addPrinter(token);
    const driver = t.drivers.latest(id);

    const answer = await t.call("PATCH", `/api/printers/${id}`, {
      token,
      json: { name: "Renamed" },
    });

    expect(answer.status).toBe(200);
    expect(await json<Config>(answer)).toMatchObject({
      name: "Renamed",
      settingsVersion: 1,
    });
    expect(t.drivers.latest(id)).toBe(driver);
    expect(t.store.get(id)?.printer.name).toBe("Renamed");
  });

  it("merges settings over the stored ones, keeping the rest", async () => {
    const t = await testApp();
    const { token } = await t.setupAdmin();
    const id = await t.addPrinter(token, "Bench", { nozzleMaxC: 260 });

    const answer = await t.call("PATCH", `/api/printers/${id}`, {
      token,
      json: { settings: { failCreate: false, nozzleMaxC: 270 } },
    });
    const keep = await t.call("PATCH", `/api/printers/${id}`, {
      token,
      json: { settings: { failCreate: true } },
    });

    expect((await json<Config>(answer)).settings).toEqual({
      nozzleMaxC: 270,
      failCreate: false,
    });
    expect(await json<Config>(keep)).toMatchObject({
      settings: { nozzleMaxC: 270, failCreate: true },
      settingsVersion: 3,
    });
  });

  it("restarts the driver for new settings, answering after it reconnects", async () => {
    const t = await testApp();
    const { token } = await t.setupAdmin();
    const id = await t.addPrinter(token);
    const before = t.drivers.latest(id);

    await t.call("PATCH", `/api/printers/${id}`, {
      token,
      json: { settings: { nozzleMaxC: 270 } },
    });

    const after = t.drivers.latest(id);
    expect(after).not.toBe(before);
    expect(after.init.settings.nozzleMaxC).toBe(270);
    expect(t.store.get(id)?.state.status).toBe("idle");
  });

  it("refuses new settings during a job with 409 job_active, but renames", async () => {
    const t = await testApp();
    const { token } = await t.setupAdmin();
    const id = await t.addPrinter(token);
    t.drivers
      .latest(id)
      .emit({ type: "status", status: "printing", detail: null, error: null });
    await vi.waitFor(() => {
      expect(t.store.get(id)?.state.status).toBe("printing");
    });

    const refused = await t.call("PATCH", `/api/printers/${id}`, {
      token,
      json: { settings: { nozzleMaxC: 270 } },
    });
    const renamed = await t.call("PATCH", `/api/printers/${id}`, {
      token,
      json: { name: "Busy" },
    });

    expect(refused.status).toBe(409);
    expect(await apiError(refused)).toEqual({
      code: "job_active",
      message: "The settings can't change while the printer is printing.",
    });
    expect(renamed.status).toBe(200);
  });

  it("refuses an empty change with 400", async () => {
    const t = await testApp();
    const { token } = await t.setupAdmin();
    const id = await t.addPrinter(token);

    const answer = await t.call("PATCH", `/api/printers/${id}`, {
      token,
      json: {},
    });

    expect(answer.status).toBe(400);
    expect((await apiError(answer)).message).toContain(
      "Give a name, settings or both.",
    );
  });

  it.each([
    ["a name", { name: "x" }],
    ["settings", { settings: { nozzleMaxC: 1 } }],
  ])("answers %s for an unknown printer with 404", async (_, change) => {
    const t = await testApp();
    const { token } = await t.setupAdmin();

    const answer = await t.call("PATCH", "/api/printers/nope", {
      token,
      json: change,
    });

    expect(answer.status).toBe(404);
    expect((await apiError(answer)).code).toBe("printer_not_found");
  });

  it("answers a taken name with 409 and invalid settings with 422", async () => {
    const t = await testApp();
    const { token } = await t.setupAdmin();
    await t.addPrinter(token, "Taken");
    const id = await t.addPrinter(token, "Bench");

    const taken = await t.call("PATCH", `/api/printers/${id}`, {
      token,
      json: { name: "taken" },
    });
    const invalid = await t.call("PATCH", `/api/printers/${id}`, {
      token,
      json: { settings: { nozzleMaxC: "hot" } },
    });

    expect(taken.status).toBe(409);
    expect(invalid.status).toBe(422);
    expect((await apiError(invalid)).code).toBe("invalid_settings");
  });
});

describe("DELETE /api/printers/{id}", () => {
  it("deletes the printer and answers 204", async () => {
    const t = await testApp();
    const { token, user } = await t.setupAdmin();
    const id = await t.addPrinter(token);

    const answer = await t.call("DELETE", `/api/printers/${id}`, { token });

    expect(answer.status).toBe(204);
    expect(t.repos.printers.findById(id)).toBeUndefined();
    expect(t.store.get(id)).toBeUndefined();
    expect(t.events.at(-1)).toMatchObject({
      type: "printer.removed",
      printerId: id,
      source: { kind: "user", userId: user.id },
    });
    expect((await t.call("GET", `/api/printers/${id}`, { token })).status).toBe(
      404,
    );
  });

  it("answers an unknown printer with 404", async () => {
    const t = await testApp();
    const { token } = await t.setupAdmin();

    const answer = await t.call("DELETE", "/api/printers/nope", { token });

    expect(answer.status).toBe(404);
  });
});
