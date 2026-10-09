// SPDX-FileCopyrightText: 2026 Open Print Stack contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

import {
  DRIVER_SOURCES,
  DriverRegistry,
  type DriverSource,
} from "./registry.ts";
import { TestDrivers } from "./test-driver.ts";

/** A registry with one type, `test`, whose import gives `imported`. */
function registryOf(imported: unknown) {
  const load = vi.fn(() => Promise.resolve(imported));
  const registry = new DriverRegistry({
    test: { specifier: "test-driver", load },
  });
  return { registry, load };
}

describe("DRIVER_SOURCES", () => {
  it("has the simulated printer and the Elegoo Centauri Carbon 2", () => {
    expect(Object.keys(DRIVER_SOURCES)).toEqual(["simulated", "elegoo-cc2"]);
  });

  it.each(Object.entries(DRIVER_SOURCES))(
    "%s: load imports the module its specifier names",
    async (_, source: DriverSource) => {
      expect(await source.load()).toBe(await import(source.specifier));
    },
  );
});

describe("DriverRegistry", () => {
  it("loads the simulated driver by default", async () => {
    const registry = new DriverRegistry();

    const module = await registry.load("simulated");

    expect(registry.types()).toEqual(["simulated", "elegoo-cc2"]);
    expect(module.manifest).toMatchObject({
      type: "simulated",
      name: "Simulated printer",
    });
    expect(module.settingsSchema).toBeInstanceOf(z.ZodObject);
  });

  it("loads the CC2 driver by default", async () => {
    const registry = new DriverRegistry();

    const module = await registry.load("elegoo-cc2");

    expect(module.manifest).toMatchObject({
      type: "elegoo-cc2",
      name: "Elegoo Centauri Carbon 2",
    });
  });

  it("imports each module once", async () => {
    const drivers = new TestDrivers();
    const { registry, load } = registryOf({ default: drivers.module });

    const [first, second] = await Promise.all([
      registry.load("test"),
      registry.load("test"),
    ]);
    const third = await registry.load("test");

    expect(first).toBe(drivers.module);
    expect(second).toBe(first);
    expect(third).toBe(first);
    expect(load).toHaveBeenCalledOnce();
  });

  it.each(["nope", "toString", "__proto__", "constructor", ""])(
    "doesn't know %j",
    async (type) => {
      const registry = new DriverRegistry();

      expect(registry.has(type)).toBe(false);
      await expect(registry.load(type)).rejects.toThrow(
        `No driver is registered for type "${type}".`,
      );
    },
  );

  it("refuses a module whose manifest names another type", async () => {
    const drivers = new TestDrivers();
    const { registry } = registryOf({
      default: {
        ...drivers.module,
        manifest: { ...drivers.module.manifest, type: "simulated" },
      },
    });

    await expect(registry.load("test")).rejects.toThrow(
      `test-driver isn't a driver module for "test": its manifest says its type is "simulated".`,
    );
  });

  const module = new TestDrivers().module;

  it.each<[string, unknown, string]>([
    ["no default export", { module }, "it has no default export."],
    ["a null default export", { default: null }, "it has no default export."],
    [
      "an invalid manifest",
      { default: { ...module, manifest: { type: "test" } } },
      "its manifest is invalid.",
    ],
    [
      "settings that aren't a Zod object",
      { default: { ...module, settingsSchema: z.string() } },
      "its settingsSchema isn't a Zod object.",
    ],
    [
      "no initialCapabilities",
      { default: { ...module, initialCapabilities: undefined } },
      "it has no initialCapabilities function.",
    ],
    [
      "no create",
      { default: { ...module, create: "soon" } },
      "it has no create function.",
    ],
  ])("refuses a module with %s", async (_, imported, reason) => {
    const { registry } = registryOf(imported);

    await expect(registry.load("test")).rejects.toThrow(
      `test-driver isn't a driver module for "test": ${reason}`,
    );
  });

  it("tries a failed import again next time", async () => {
    const drivers = new TestDrivers();
    const load = vi
      .fn<() => Promise<unknown>>()
      .mockRejectedValueOnce(new Error("Cannot find package"))
      .mockResolvedValueOnce({ default: drivers.module });
    const registry = new DriverRegistry({
      test: { specifier: "test-driver", load },
    });

    await expect(registry.load("test")).rejects.toThrow("Cannot find package");
    await expect(registry.load("test")).resolves.toBe(drivers.module);
  });
});
