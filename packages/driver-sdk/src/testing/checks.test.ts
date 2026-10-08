// SPDX-FileCopyrightText: 2026 Open Print Stack contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

// Each conformance check against a driver broken in the way it should catch.

import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";

import type {
  DriverModule,
  PrinterDriver,
  StartPrintRequest,
} from "../contract.ts";
import {
  fakeDriver,
  fakeSettingsSchema,
  patchFakeDriver,
} from "../fake-driver.ts";
import { CONFORMANCE_CHECKS } from "./index.ts";

const created: PrinterDriver[] = [];

afterEach(async () => {
  // Patched drivers may not stop their own timers.
  await Promise.all(created.splice(0).map((driver) => driver.dispose()));
});

class Skipped extends Error {}

/** Runs one check, by name, against `module`. */
async function runCheck(
  name: string,
  module: DriverModule,
  settings: Record<string, unknown> = { tickMs: 5 },
): Promise<void> {
  const check = CONFORMANCE_CHECKS.find((candidate) => candidate.name === name);
  if (check === undefined) {
    throw new Error(`No check called "${name}".`);
  }
  await check.run({
    module,
    fixture: { settings, timeoutMs: 1000, quietPeriodMs: 50 },
    skip: (note) => {
      throw new Skipped(note);
    },
  });
}

const patch = (fn: Parameters<typeof patchFakeDriver>[0]) =>
  patchFakeDriver(fn, created);

const ok = () => Promise.resolve();

describe("the conformance checks", () => {
  it("all pass for the fake driver", async () => {
    for (const check of CONFORMANCE_CHECKS) {
      await runCheck(check.name, fakeDriver);
    }
  });

  it.each([
    ["an empty name", { name: "" }],
    ["no description", { description: undefined }],
  ])("fail a manifest with %s", async (_name, change) => {
    const module = {
      ...fakeDriver,
      manifest: { ...fakeDriver.manifest, ...change },
    } as DriverModule;

    await expect(runCheck("has a valid manifest", module)).rejects.toThrow();
  });

  it.each([
    ["an empty list", []],
    ["an empty step", ["Switch on LAN mode.", ""]],
  ])("fail setup help with %s", async (_name, setupHelp) => {
    const module = {
      ...fakeDriver,
      manifest: { ...fakeDriver.manifest, setupHelp },
    } as DriverModule;

    await expect(runCheck("has a valid manifest", module)).rejects.toThrow(
      /setupHelp/,
    );
  });

  it("pass a manifest with setup help", async () => {
    const module = {
      ...fakeDriver,
      manifest: {
        ...fakeDriver.manifest,
        setupHelp: ["Switch on LAN mode.", "Set an access code."],
      },
    } as DriverModule;

    await runCheck("has a valid manifest", module);
  });

  it.each([
    ["a nested object", z.object({ address: z.object({ host: z.string() }) })],
    ["a nullable field", z.object({ host: z.string().nullable() })],
    ["an array", z.object({ hosts: z.array(z.string()) })],
    ["a Date, which JSON Schema can't describe", z.object({ at: z.date() })],
  ])("fail settings with %s", async (_name, settingsSchema) => {
    const module = { ...fakeDriver, settingsSchema } as unknown as DriverModule;

    await expect(
      runCheck(
        "has a flat settings schema the UI can render as a form",
        module,
      ),
    ).rejects.toThrow();
  });

  describe("marks only plain strings with no default as write-only", () => {
    const check = "marks only plain strings with no default as write-only";
    const writeOnly = { writeOnly: true };

    it("passes required and optional write-only strings", async () => {
      const module = {
        ...fakeDriver,
        settingsSchema: fakeSettingsSchema.extend({
          accessCode: z.string().min(1).meta(writeOnly),
          apiKey: z.string().optional().meta(writeOnly),
        }),
      } as unknown as DriverModule;

      await runCheck(check, module);
    });

    it.each([
      ["a number", z.number().meta(writeOnly)],
      ["a boolean", z.boolean().optional().meta(writeOnly)],
      ["an enum", z.enum(["a", "b"]).meta(writeOnly)],
      ["a literal", z.literal("secret").meta(writeOnly)],
      ["a default", z.string().default("1234").meta(writeOnly)],
      ["writeOnly that isn't a boolean", z.string().meta({ writeOnly: "yes" })],
    ])("fails %s", async (_name, field) => {
      const module = {
        ...fakeDriver,
        settingsSchema: fakeSettingsSchema.extend({ accessCode: field }),
      } as unknown as DriverModule;

      await expect(runCheck(check, module)).rejects.toThrow(/accessCode/);
    });
  });

  it("fail a default that breaks its own field's rules", async () => {
    const module = {
      ...fakeDriver,
      settingsSchema: z.object({ tickMs: z.number().positive().default(-1) }),
    } as unknown as DriverModule;

    await expect(
      runCheck("accepts the fixture's settings and its own defaults", module),
    ).rejects.toThrow(/tickMs/);
  });

  it("fail fixture settings the schema rejects", async () => {
    await expect(
      runCheck(
        "accepts the fixture's settings and its own defaults",
        fakeDriver,
        { tickMs: "fast" },
      ),
    ).rejects.toThrow(/tickMs/);
  });

  it.each([
    [
      "a Date",
      { maxMoveSpeedMmS: new Date(0) },
      "Not serialisable: capabilities.maxMoveSpeedMmS is a Date.",
    ],
    ["a missing field", { cameras: undefined }, /cameras/],
  ])("fail initial capabilities with %s", async (_name, change, error) => {
    const module = {
      ...fakeDriver,
      initialCapabilities: (settings: never) => ({
        ...fakeDriver.initialCapabilities(settings),
        ...change,
      }),
    } as unknown as DriverModule;

    await expect(
      runCheck("reports valid initial capabilities", module),
    ).rejects.toThrow(error);
  });

  describe("connects and reports a status", () => {
    const check = "connects and reports a status";

    it.each([
      ["a Date", new Date(0), "message.message.detail is a Date"],
      ["a function", () => "idle", "message.message.detail is a function"],
    ])("fails a driver that emits %s", async (_name, detail, problem) => {
      const module = patch((_driver, ctx) => ({
        connect: () => {
          ctx.emit({
            type: "status",
            status: "idle",
            detail: detail as unknown as string,
            error: null,
          });
          return ok();
        },
      }));

      await expect(runCheck(check, module)).rejects.toThrow(problem);
    });

    it("fails a driver that emits an invalid message", async () => {
      const module = patch((_driver, ctx) => ({
        connect: () => {
          ctx.emit({ type: "status", status: "exploded" } as never);
          ctx.emit({
            type: "status",
            status: "idle",
            detail: null,
            error: null,
          });
          return ok();
        },
      }));

      await expect(runCheck(check, module)).rejects.toThrow(/invalid message/);
    });

    it("fails a driver that reports no status", async () => {
      const module = patch(() => ({ connect: ok }));

      await expect(runCheck(check, module)).rejects.toThrow();
    });

    it("passes a driver that reports offline when it can't connect", async () => {
      await runCheck(check, fakeDriver, { tickMs: 5, reachable: false });
    });
  });

  it("fail a driver missing a required method", async () => {
    const module = patch(() => ({ pause: undefined }));

    await expect(
      runCheck("implements every required method", module),
    ).rejects.toThrow(/pause/);
  });

  it("fail a driver that declares extensions without invokeExtension", async () => {
    const module = patch(() => ({ invokeExtension: undefined }));

    await expect(
      runCheck("implements every required method", module),
    ).rejects.toThrow(/invokeExtension/);
  });

  it("fail an invalid file list", async () => {
    const module = patch(() => ({
      listFiles: () => Promise.resolve({ files: [{ name: "" }] } as never),
    }));

    await expect(runCheck("lists its files", module)).rejects.toThrow(
      /invalid result for "listFiles"/,
    );
  });

  it("fail a snapshot that isn't an image", async () => {
    const module = patch(() => ({
      getSnapshot: () =>
        Promise.resolve({ mimeType: "text/html", data: new Uint8Array([1]) }),
    }));

    await expect(
      runCheck("lists its cameras and takes a snapshot from each", module),
    ).rejects.toThrow(/invalid result for "getSnapshot"/);
  });

  it("skip snapshots when the printer has no cameras", async () => {
    await expect(
      runCheck("lists its cameras and takes a snapshot from each", fakeDriver, {
        cameraEnabled: false,
      }),
    ).rejects.toBeInstanceOf(Skipped);
  });

  it("fail a driver that accepts an unknown extension", async () => {
    const module = patch(() => ({ invokeExtension: ok }));

    await expect(
      runCheck("answers an unknown extension with not_supported", module),
    ).rejects.toThrow();
  });

  it("fail a driver that doesn't report offline after disconnect", async () => {
    const module = patch((driver) => ({
      disconnect: () => driver.dispose(),
    }));

    await expect(
      runCheck("reports offline after disconnect", module),
    ).rejects.toThrow(/offline/);
  });

  it("fail a driver that keeps emitting after dispose", async () => {
    const module = patch(() => ({ dispose: ok }));

    await expect(
      runCheck("emits nothing after dispose", module),
    ).rejects.toThrow();
  });

  it("time out a call the driver never answers", async () => {
    const module = patch(() => ({
      connect: () => new Promise<void>(() => undefined),
    }));

    await expect(
      runCheck("connects and reports a status", module),
    ).rejects.toMatchObject({ code: "timeout" });
  });

  it("never print, move or heat", async () => {
    const calls: string[] = [];
    const module = patch((driver) => ({
      startPrint: (request: StartPrintRequest) => {
        calls.push("startPrint");
        return driver.startPrint(request);
      },
      home: () => {
        calls.push("home");
        return ok();
      },
      move: () => {
        calls.push("move");
        return ok();
      },
      setTemperature: () => {
        calls.push("setTemperature");
        return ok();
      },
      setFan: () => {
        calls.push("setFan");
        return ok();
      },
    }));

    for (const check of CONFORMANCE_CHECKS) {
      await runCheck(check.name, module);
    }

    expect(calls).toEqual([]);
  });
});
