// SPDX-FileCopyrightText: 2026 Open Print Stack contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from "vitest";
import { z } from "zod";

import { fakeDriver } from "./fake-driver.ts";
import { defaultSettings, defineDriver, settingsJsonSchema } from "./index.ts";

const networked = defineDriver({
  ...fakeDriver,
  settingsSchema: z.object({
    host: z.string().min(1).describe("Printer address"),
    port: z.int().default(7125),
    mode: z.enum(["lan", "cloud"]).default("lan"),
    accessCode: z.string().optional(),
  }),
  initialCapabilities: () =>
    fakeDriver.initialCapabilities({
      tickMs: 20,
      cameraEnabled: false,
      reachable: true,
    }),
  create: () => {
    throw new Error("Not used.");
  },
});

describe("settingsJsonSchema", () => {
  it("describes the input: defaulted fields are optional and carry their default", () => {
    const schema = settingsJsonSchema(networked);

    expect(schema.type).toBe("object");
    expect(schema.required).toEqual(["host"]);
    expect(schema.properties).toMatchObject({
      host: { type: "string", minLength: 1, description: "Printer address" },
      port: { type: "integer", default: 7125 },
      mode: { type: "string", enum: ["lan", "cloud"], default: "lan" },
      accessCode: { type: "string" },
    });
  });
});

describe("defaultSettings", () => {
  it("returns every field's default and leaves out fields without one", () => {
    expect(defaultSettings(networked)).toEqual({ port: 7125, mode: "lan" });
  });

  it("returns the fake driver's defaults", () => {
    expect(defaultSettings(fakeDriver)).toEqual({
      tickMs: 20,
      cameraEnabled: true,
      reachable: true,
    });
  });
});
