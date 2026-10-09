// SPDX-FileCopyrightText: 2026 Open Print Stack contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  defaultSettings,
  settingsJsonSchema,
  writeOnlySettings,
} from "@openprintstack/driver-sdk";
import { describe, expect, it } from "vitest";

import elegooCc2Driver, { cc2Capabilities } from "./index.ts";
import { cc2SettingsSchema } from "./settings.ts";

describe("the manifest", () => {
  it("names the driver type and explains the setup", () => {
    expect(elegooCc2Driver.manifest).toMatchObject({
      type: "elegoo-cc2",
      name: "Elegoo Centauri Carbon 2",
    });
    expect(elegooCc2Driver.manifest.setupHelp).toEqual([
      expect.stringContaining("turn on LAN Only mode"),
      expect.stringContaining("set an access code"),
      expect.stringContaining("IP address and the access code"),
      expect.stringContaining("about 4 connections"),
    ]);
  });
});

describe("cc2SettingsSchema", () => {
  it("needs an address and an access code, and defaults the rest", () => {
    expect(
      cc2SettingsSchema.parse({ host: "192.168.1.50", accessCode: "1234" }),
    ).toEqual({
      host: "192.168.1.50",
      accessCode: "1234",
      autoBedLevel: true,
      timelapse: false,
      bedSide: "A",
    });
    expect(cc2SettingsSchema.safeParse({ host: "192.168.1.50" }).success).toBe(
      false,
    );
    expect(cc2SettingsSchema.safeParse({ accessCode: "1234" }).success).toBe(
      false,
    );
  });

  it("keeps the access code write-only", () => {
    expect(writeOnlySettings(elegooCc2Driver)).toEqual(["accessCode"]);
  });

  it("publishes its defaults, titles and the address pattern", () => {
    const schema = settingsJsonSchema(elegooCc2Driver);

    expect(defaultSettings(elegooCc2Driver)).toEqual({
      autoBedLevel: true,
      timelapse: false,
      bedSide: "A",
    });
    expect(schema.required).toEqual(["host", "accessCode"]);
    expect(schema.properties).toMatchObject({
      host: {
        title: "Address",
        type: "string",
        pattern: expect.any(String) as unknown,
      },
      accessCode: { title: "Access code", writeOnly: true },
      autoBedLevel: { title: "Auto bed levelling", default: true },
      timelapse: { title: "Timelapse", default: false },
      bedSide: { title: "Build plate side", enum: ["A", "B"], default: "A" },
    });
  });

  it.each([
    "192.168.1.50",
    "10.0.0.7",
    "cc2",
    "cc2.local",
    "centauri-carbon-2.home.arpa",
    "fe80::1",
    "2001:db8::42",
    "::ffff:192.168.1.50",
  ])("accepts the address %s", (host) => {
    expect(cc2SettingsSchema.shape.host.safeParse(host).success).toBe(true);
  });

  it.each([
    "",
    " 192.168.1.50",
    "192.168.1.50 ",
    "http://192.168.1.50",
    "192.168.1.50:1883",
    "cc2.local:80",
    "192.168.1.50/upload",
    "-cc2",
    "cc2-",
    "a".repeat(254),
  ])("refuses the address %j", (host) => {
    expect(cc2SettingsSchema.shape.host.safeParse(host).success).toBe(false);
  });

  it("explains a refused address", () => {
    const result = cc2SettingsSchema.shape.host.safeParse("http://cc2");

    expect(result.error?.issues[0]?.message).toBe(
      "Enter just the IP address or host name, with no spaces, http:// or port.",
    );
  });

  it("checks the address the same way in the web form", () => {
    // The web form runs the published pattern with the "u" flag.
    const property = settingsJsonSchema(elegooCc2Driver).properties?.host;
    const pattern = new RegExp((property as { pattern: string }).pattern, "u");

    for (const host of ["192.168.1.50", "cc2.local", "fe80::1"]) {
      expect(pattern.test(host), host).toBe(true);
    }
    for (const host of ["http://cc2", "192.168.1.50:1883", "a b"]) {
      expect(pattern.test(host), host).toBe(false);
    }
  });
});

describe("cc2Capabilities", () => {
  it("reports Elegoo's limits, the build volume and nothing to command yet", () => {
    expect(cc2Capabilities()).toEqual({
      commands: [],
      heaters: [
        {
          id: "nozzle",
          kind: "nozzle",
          label: "Nozzle",
          controllable: true,
          maxC: 350,
        },
        { id: "bed", kind: "bed", label: "Bed", controllable: true, maxC: 110 },
        {
          id: "chamber",
          kind: "chamber",
          label: "Chamber",
          controllable: false,
          maxC: null,
        },
      ],
      fans: [
        { id: "part", kind: "part", label: "Part cooling", controllable: true },
        {
          id: "auxiliary",
          kind: "auxiliary",
          label: "Auxiliary",
          controllable: true,
        },
        {
          id: "chamber",
          kind: "chamber",
          label: "Chamber exhaust",
          controllable: true,
        },
        { id: "hotend", kind: "other", label: "Hotend", controllable: false },
        {
          id: "mainboard",
          kind: "other",
          label: "Mainboard",
          controllable: false,
        },
      ],
      axes: {
        x: { minMm: 0, maxMm: 256 },
        y: { minMm: 0, maxMm: 256 },
        z: { minMm: 0, maxMm: 256 },
      },
      maxMoveSpeedMmS: null,
      files: {
        list: false,
        upload: false,
        acceptedExtensions: [".gcode"],
        maxUploadBytes: null,
      },
      cameras: { snapshot: false, stream: false },
      extensions: [],
    });
  });

  it("gives a fresh copy each time", () => {
    const first = cc2Capabilities();
    first.heaters.pop();

    expect(cc2Capabilities().heaters).toHaveLength(3);
  });
});
