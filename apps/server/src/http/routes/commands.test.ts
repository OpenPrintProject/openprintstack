// SPDX-FileCopyrightText: 2026 Open Print Stack contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { DriverError, type DriverErrorCode } from "@openprintstack/driver-sdk";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { jsonLines } from "../../test-utils.ts";
import { apiError, testApp } from "../test-app.ts";

async function withPrinter() {
  const t = await testApp();
  const { token, user } = await t.setupAdmin();
  const id = await t.addPrinter(token);
  t.events.length = 0;
  const run = (command: unknown) =>
    t.call("POST", `/api/printers/${id}/commands`, { token, json: command });
  return { ...t, token, user, id, driver: t.drivers.latest(id), run };
}

describe("POST /api/printers/{id}/commands", () => {
  it("runs the command and answers 200 with its id and duration", async () => {
    const t = await withPrinter();

    const answer = await t.run({ kind: "motion.home", axes: [] });

    expect(answer.status).toBe(200);
    const result = (await answer.json()) as {
      commandId: string;
      ok: boolean;
      durationMs: number;
    };
    expect(result).toEqual({
      commandId: expect.any(String) as unknown,
      ok: true,
      durationMs: expect.any(Number) as unknown,
    });
    expect(z.uuidv7().safeParse(result.commandId).success).toBe(true);
    expect(t.driver.calls.at(-1)).toEqual({ op: "home", args: { axes: [] } });
    expect(
      t.events.map(({ type, source, correlationId, payload }) => ({
        type,
        source,
        correlationId,
        payload,
      })),
    ).toEqual([
      {
        type: "command.requested",
        source: { kind: "user", userId: t.user.id },
        correlationId: result.commandId,
        payload: {
          commandId: result.commandId,
          command: { kind: "motion.home", axes: [] },
        },
      },
      {
        type: "command.result",
        source: { kind: "user", userId: t.user.id },
        correlationId: result.commandId,
        payload: result,
      },
    ]);
  });

  it.each([
    [
      "unsupported",
      422,
      { kind: "temperature.set", heaterId: "chamber", targetC: 40 },
      'The printer has no heater "chamber".',
    ],
    [
      "unsafe",
      422,
      { kind: "temperature.set", heaterId: "nozzle", targetC: 400 },
      "400 °C is above the Nozzle's 250 °C maximum.",
    ],
    [
      "invalid_state",
      409,
      { kind: "print.pause" },
      "print.pause isn't allowed while the printer is idle.",
    ],
  ])(
    "answers a %s refusal with %i, the command's id and both events",
    async (code, status, command, message) => {
      const t = await withPrinter();

      const answer = await t.run(command);

      expect(answer.status).toBe(status);
      const error = await apiError(answer);
      const result = t.events.find((event) => event.type === "command.result");
      expect(result?.payload).toMatchObject({ ok: false, error: { code } });
      expect(error).toEqual({
        code,
        message,
        details: {
          commandId: result?.correlationId,
          durationMs: expect.any(Number) as unknown,
        },
      });
      expect(t.types()).toEqual(["command.requested", "command.result"]);
    },
  );

  it("answers 409 printer_offline straight away for an offline printer", async () => {
    const t = await withPrinter();
    t.driver.emit({
      type: "status",
      status: "offline",
      detail: null,
      error: null,
    });
    await vi.waitFor(() => {
      expect(t.store.get(t.id)?.state.status).toBe("offline");
    });
    const calls = t.driver.calls.length;

    const answer = await t.run({ kind: "motion.home", axes: [] });

    expect(answer.status).toBe(409);
    expect((await apiError(answer)).code).toBe("printer_offline");
    expect(t.driver.calls).toHaveLength(calls);
  });

  it("answers 409 printer_busy while another command runs", async () => {
    const t = await withPrinter();
    let finish!: () => void;
    t.driver.handle(
      "home",
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    const first = t.run({ kind: "motion.home", axes: [] });
    await vi.waitFor(() => {
      expect(t.driver.ops()).toContain("home");
    });

    const second = await t.run({ kind: "motion.home", axes: [] });
    finish();

    expect(second.status).toBe(409);
    expect((await apiError(second)).code).toBe("printer_busy");
    expect((await first).status).toBe(200);
  });

  it.each([
    ["printer_rejected", 422],
    ["file_not_found", 404],
    ["timeout", 504],
    ["internal", 500],
    ["not_supported", 422],
    ["invalid_state", 409],
    ["offline", 409],
  ] as const)(
    "answers the driver's %s with %i",
    async (driverCode: DriverErrorCode, status) => {
      const t = await withPrinter();
      t.driver.handle("startPrint", () => {
        throw new DriverError(driverCode, "The printer said no.");
      });

      const answer = await t.run({ kind: "print.start", fileName: "a.gcode" });

      expect(answer.status).toBe(status);
      expect((await apiError(answer)).message).toBe("The printer said no.");
    },
  );

  it("answers a driver bug with 500 internal and logs it", async () => {
    const t = await withPrinter();
    t.driver.handle("startPrint", () => {
      throw new TypeError("x is undefined");
    });

    const answer = await t.run({ kind: "print.start", fileName: "a.gcode" });

    expect(answer.status).toBe(500);
    expect((await apiError(answer)).code).toBe("internal");
    expect(jsonLines(t.logs)).toContainEqual(
      expect.objectContaining({ level: "error", component: "commands" }),
    );
  });

  it("refuses file.upload, which only uploads create, with 400 and no events", async () => {
    const t = await withPrinter();

    const answer = await t.run({
      kind: "file.upload",
      stagedFileId: "0199b3a0-1c00-7000-8000-000000000001",
      fileName: "a.gcode",
      sizeBytes: 1,
    });

    expect(answer.status).toBe(400);
    expect((await apiError(answer)).code).toBe("validation_failed");
    expect(t.events).toEqual([]);
    expect(t.driver.ops()).not.toContain("sendFile");
  });

  it.each([
    ["an unknown kind", { kind: "printer.explode" }],
    ["a fan over 100 %", { kind: "fan.set", fanId: "part", percent: 101 }],
    ["a move with no axis", { kind: "motion.move" }],
    [
      "a negative target",
      { kind: "temperature.set", heaterId: "bed", targetC: -1 },
    ],
  ])("refuses %s with 400 before any event", async (_, command) => {
    const t = await withPrinter();

    const answer = await t.run(command);

    expect(answer.status).toBe(400);
    expect(t.events).toEqual([]);
  });

  it("answers an unknown printer with 404 and no events", async () => {
    const t = await withPrinter();

    const answer = await t.call("POST", "/api/printers/nope/commands", {
      token: t.token,
      json: { kind: "print.pause" },
    });

    expect(answer.status).toBe(404);
    expect((await apiError(answer)).code).toBe("printer_not_found");
    expect(t.events).toEqual([]);
  });

  it("runs extension.invoke through the generic route too", async () => {
    const t = await withPrinter();

    const answer = await t.run({
      kind: "extension.invoke",
      extension: "test",
      action: "poke",
      params: { times: 2 },
    });

    expect(answer.status).toBe(200);
    expect(t.driver.calls.at(-1)).toEqual({
      op: "invokeExtension",
      args: { extension: "test", action: "poke", params: { times: 2 } },
    });
  });
});
