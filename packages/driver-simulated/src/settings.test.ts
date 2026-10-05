// SPDX-FileCopyrightText: 2026 Open Print Stack contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  defaultSettings,
  DriverManifest,
  settingsJsonSchema,
} from "@openprintstack/driver-sdk";
import { Capabilities, CommandKind } from "@openprintstack/protocol";
import { describe, expect, it } from "vitest";

import simulatedDriver from "./index.ts";
import { simulatedSettingsSchema } from "./settings.ts";
import type { SettingsInput } from "./test-utils.ts";

describe("the module", () => {
  it("has the simulated manifest", () => {
    expect(DriverManifest.parse(simulatedDriver.manifest)).toMatchObject({
      type: "simulated",
      name: "Simulated printer",
    });
  });
});

describe("settings", () => {
  it("default to the plan's values", () => {
    expect(defaultSettings(simulatedDriver)).toEqual({
      printDurationS: 600,
      speedMultiplier: 1,
      heatUpS: 20,
      nozzleMaxC: 300,
      bedMaxC: 120,
      buildVolumeXMm: 256,
      buildVolumeYMm: 256,
      buildVolumeZMm: 256,
      maxMoveSpeedMmS: 200,
      cameraEnabled: true,
    });
  });

  it("give every field a title and description for the form", () => {
    const properties = settingsJsonSchema(simulatedDriver).properties ?? {};

    const unlabelled = Object.entries(properties)
      .filter(
        ([, property]) =>
          typeof property !== "object" ||
          typeof property.title !== "string" ||
          typeof property.description !== "string",
      )
      .map(([key]) => key);

    expect(Object.keys(properties)).toHaveLength(10);
    expect(unlabelled).toEqual([]);
  });

  const bounds: [keyof SettingsInput, number, number][] = [
    ["printDurationS", 1, 86_400],
    ["speedMultiplier", 0.1, 1000],
    ["heatUpS", 0, 600],
    ["nozzleMaxC", 100, 500],
    ["bedMaxC", 50, 200],
    ["buildVolumeXMm", 10, 2000],
    ["buildVolumeYMm", 10, 2000],
    ["buildVolumeZMm", 10, 2000],
    ["maxMoveSpeedMmS", 1, 1000],
  ];

  it.each(bounds)(
    "accept %s from %d to %d, and nothing outside",
    (key, min, max) => {
      const step = key === "speedMultiplier" ? 0.01 : 1;

      expect(simulatedSettingsSchema.safeParse({ [key]: min }).success).toBe(
        true,
      );
      expect(simulatedSettingsSchema.safeParse({ [key]: max }).success).toBe(
        true,
      );
      expect(
        simulatedSettingsSchema.safeParse({ [key]: min - step }).success,
      ).toBe(false);
      expect(
        simulatedSettingsSchema.safeParse({ [key]: max + step }).success,
      ).toBe(false);
    },
  );

  it("take whole seconds for the print duration", () => {
    expect(
      simulatedSettingsSchema.safeParse({ printDurationS: 1.5 }).success,
    ).toBe(false);
  });
});

describe("capabilities", () => {
  it("follow the settings", () => {
    const capabilities = simulatedDriver.initialCapabilities(
      simulatedSettingsSchema.parse({
        nozzleMaxC: 280,
        bedMaxC: 100,
        buildVolumeXMm: 220,
        buildVolumeYMm: 230,
        buildVolumeZMm: 240,
        maxMoveSpeedMmS: 150,
        cameraEnabled: false,
      }),
    );

    expect(Capabilities.parse(capabilities)).toEqual({
      commands: CommandKind.options,
      heaters: [
        { id: "nozzle", kind: "nozzle", label: "Nozzle", maxC: 280 },
        { id: "bed", kind: "bed", label: "Bed", maxC: 100 },
        { id: "chamber", kind: "chamber", label: "Chamber", maxC: 60 },
      ],
      fans: [
        { id: "part", kind: "part", label: "Part cooling", controllable: true },
        { id: "hotend", kind: "other", label: "Hotend", controllable: false },
      ],
      axes: {
        x: { minMm: 0, maxMm: 220 },
        y: { minMm: 0, maxMm: 230 },
        z: { minMm: 0, maxMm: 240 },
      },
      maxMoveSpeedMmS: 150,
      files: {
        list: true,
        upload: true,
        acceptedExtensions: [".gcode", ".3mf"],
        maxUploadBytes: 1024 ** 3,
      },
      cameras: { snapshot: false, stream: false },
      extensions: ["simulator"],
    });
  });
});
