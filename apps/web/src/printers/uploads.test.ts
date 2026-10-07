// SPDX-FileCopyrightText: 2026 Open Print Stack contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from "vitest";

import { acceptAttribute, uploadProblem } from "./uploads.ts";

const SIMULATOR = {
  list: true,
  upload: true,
  acceptedExtensions: [".gcode", ".3mf"],
  maxUploadBytes: 1024 ** 3,
};

describe("uploadProblem", () => {
  it.each(["part.gcode", "PART.GCODE", "box.3mf", "a.b.gcode"])(
    "takes %j",
    (name) => {
      expect(uploadProblem({ name, size: 10 }, SIMULATOR, "Sim 1")).toBeNull();
    },
  );

  it.each(["part.stl", "gcode", "part.gcode.zip", "part.3mfx"])(
    "refuses %j",
    (name) => {
      expect(uploadProblem({ name, size: 10 }, SIMULATOR, "Sim 1")).toBe(
        "Sim 1 only takes .gcode or .3mf files.",
      );
    },
  );

  it("takes any file from a printer that lists no extensions", () => {
    expect(
      uploadProblem(
        { name: "anything.bin", size: 10 },
        { ...SIMULATOR, acceptedExtensions: [] },
        "Sim 1",
      ),
    ).toBeNull();
  });

  it("takes exactly the size limit, and refuses a byte more", () => {
    const files = { ...SIMULATOR, maxUploadBytes: 1000 };

    expect(
      uploadProblem({ name: "a.gcode", size: 1000 }, files, "Sim 1"),
    ).toBeNull();
    expect(uploadProblem({ name: "a.gcode", size: 1001 }, files, "Sim 1")).toBe(
      "a.gcode is 1,001 bytes; Sim 1 takes at most 1,000 bytes.",
    );
  });

  it("rounds the sizes when that still tells them apart", () => {
    expect(
      uploadProblem(
        { name: "a.gcode", size: 2_500_000_000 },
        SIMULATOR,
        "Sim 1",
      ),
    ).toBe("a.gcode is 2.5 GB; Sim 1 takes at most 1.1 GB.");
  });

  it("has no size limit when the printer doesn't report one", () => {
    expect(
      uploadProblem(
        { name: "a.gcode", size: 10 ** 12 },
        { ...SIMULATOR, maxUploadBytes: null },
        "Sim 1",
      ),
    ).toBeNull();
  });
});

describe("acceptAttribute", () => {
  it("lists the printer's extensions, or leaves the picker open to anything", () => {
    expect(acceptAttribute(SIMULATOR)).toBe(".gcode,.3mf");
    expect(
      acceptAttribute({ ...SIMULATOR, acceptedExtensions: [] }),
    ).toBeUndefined();
  });
});
