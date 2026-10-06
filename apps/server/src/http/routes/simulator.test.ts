// SPDX-FileCopyrightText: 2026 Open Print Stack contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it, vi } from "vitest";

import { apiError, testApp } from "../test-app.ts";

// The simulator routes against the real simulated printer, which the
// registry loads as "simulated".

async function withSimulator() {
  const t = await testApp();
  const { token, user } = await t.setupAdmin();
  const id = await t.addPrinter(token, "Sim", {}, "simulated");
  await vi.waitFor(() => {
    expect(t.store.get(id)?.state.status).toBe("idle");
  });
  t.events.length = 0;
  const simulate = (action: string, json?: unknown) =>
    t.call("POST", `/api/printers/${id}/simulator/${action}`, {
      token,
      ...(json !== undefined && { json }),
    });
  const status = () => t.store.get(id)?.state;
  return { ...t, token, user, id, simulate, status };
}

describe("the simulator routes", () => {
  it("puts the printer in error with a message, and clears it", async () => {
    const t = await withSimulator();

    const fault = await t.simulate("faults/error", { message: "Nozzle clog" });

    expect(fault.status).toBe(200);
    expect(await fault.json()).toMatchObject({ ok: true });
    await vi.waitFor(() => {
      expect(t.status()).toMatchObject({
        status: "error",
        error: { message: "Nozzle clog" },
      });
    });
    expect(t.events[0]).toMatchObject({
      type: "command.requested",
      source: { kind: "user", userId: t.user.id },
      payload: {
        command: {
          kind: "extension.invoke",
          extension: "simulator",
          action: "fault.error",
          params: { message: "Nozzle clog" },
        },
      },
    });

    const clear = await t.simulate("clear");

    expect(clear.status).toBe(200);
    await vi.waitFor(() => {
      expect(t.status()?.status).toBe("idle");
    });
  });

  it.each([
    ["no body", undefined, {}],
    ["null", null, null],
    ["{}", {}, {}],
  ])("takes the error fault with %s", async (_, body, params) => {
    const t = await withSimulator();

    const answer = await t.simulate("faults/error", body);

    expect(answer.status).toBe(200);
    expect(t.events[0]?.payload).toMatchObject({ command: { params } });
  });

  it("disconnects, so commands fail at once, until clear", async () => {
    const t = await withSimulator();

    const answer = await t.simulate("faults/disconnect", { durationS: 600 });

    expect(answer.status).toBe(200);
    await vi.waitFor(() => {
      expect(t.status()?.status).toBe("offline");
    });
    const refused = await t.call("POST", `/api/printers/${t.id}/commands`, {
      token: t.token,
      json: { kind: "motion.home", axes: [] },
    });
    expect(refused.status).toBe(409);
    expect((await apiError(refused)).code).toBe("printer_offline");

    expect((await t.simulate("clear")).status).toBe(200);
    await vi.waitFor(() => {
      expect(t.status()?.status).toBe("idle");
    });
  });

  it("changes the speed", async () => {
    const t = await withSimulator();

    const answer = await t.simulate("speed", { multiplier: 60 });

    expect(answer.status).toBe(200);
    expect(t.events[0]?.payload).toMatchObject({
      command: { action: "set_speed", params: { multiplier: 60 } },
    });
  });

  it("passes filament runout to the simulator, which refuses it while idle", async () => {
    const t = await withSimulator();

    const answer = await t.simulate("faults/filament-runout");

    expect(answer.status).toBe(409);
    expect(await apiError(answer)).toMatchObject({
      code: "invalid_state",
      details: { commandId: expect.any(String) as unknown },
    });
    expect(t.events[0]?.payload).toMatchObject({
      command: { action: "fault.filament_runout" },
    });
  });

  it.each([
    ["faults/disconnect", { durationS: 0 }],
    ["faults/disconnect", { durationS: 3601 }],
    ["faults/disconnect", {}],
    ["faults/disconnect", undefined],
    ["speed", { multiplier: 0.05 }],
    ["speed", { multiplier: 1001 }],
    ["faults/error", { message: "" }],
    ["faults/error", { message: "x", extra: true }],
    ["clear", { now: true }],
    ["faults/filament-runout", { now: true }],
  ])(
    "refuses %s with %j using the simulator's bounds, before any event",
    async (action, body) => {
      const t = await withSimulator();

      const answer = await t.simulate(action, body);

      expect(answer.status).toBe(400);
      expect((await apiError(answer)).code).toBe("validation_failed");
      expect(t.events).toEqual([]);
    },
  );

  it("takes both ends of the simulator's ranges", async () => {
    const t = await withSimulator();

    expect((await t.simulate("speed", { multiplier: 0.1 })).status).toBe(200);
    expect((await t.simulate("speed", { multiplier: 1000 })).status).toBe(200);
    expect(
      (await t.simulate("faults/disconnect", { durationS: 3600 })).status,
    ).toBe(200);
    expect((await t.simulate("clear")).status).toBe(200);
  });

  it("answers 422 for a printer without the simulator extension", async () => {
    const t = await testApp();
    const { token } = await t.setupAdmin();
    const id = await t.addPrinter(token);

    const answer = await t.call("POST", `/api/printers/${id}/simulator/clear`, {
      token,
    });

    expect(answer.status).toBe(422);
    expect(await apiError(answer)).toMatchObject({
      code: "unsupported",
      message: 'The printer has no "simulator" extension.',
    });
  });
});
