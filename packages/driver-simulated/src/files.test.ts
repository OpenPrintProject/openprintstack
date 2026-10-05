// SPDX-FileCopyrightText: 2026 Open Print Stack contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import type { DriverContext } from "@openprintstack/driver-sdk";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { MAX_UPLOAD_BYTES } from "./capabilities.ts";
import simulatedDriver from "./index.ts";
import { simulatedSettingsSchema } from "./settings.ts";
import { createSim, type Sim } from "./test-utils.ts";

let sim: Sim;

beforeEach(async () => {
  vi.useFakeTimers();
  sim = await createSim({ printDurationS: 10, heatUpS: 2 });
  await sim.client.connect();
});

afterEach(async () => {
  expect(sim.protocolErrors).toEqual([]);
  await sim.close();
  vi.useRealTimers();
});

function filesDir(): string {
  return join(sim.storageDir, "files");
}

/** Sends a file staged under a safe name as `fileName`. */
async function send(fileName: string): Promise<void> {
  const path = await sim.stage("staged.gcode");
  await sim.client.sendFile({ fileName, sizeBytes: 4, path });
}

describe("uploading", () => {
  it("copies the staged file into the printer's folder and reports the change", async () => {
    const staged = await sim.stage("cube.gcode", "G28\nG1 X10\n");
    await sim.client.sendFile({
      fileName: "cube.gcode",
      sizeBytes: 11,
      path: staged,
    });

    expect(sim.all("files_changed")).toHaveLength(1);
    expect(await readFile(join(filesDir(), "cube.gcode"), "utf8")).toBe(
      "G28\nG1 X10\n",
    );
    // Copied, not moved: the server owns the staged file.
    expect(await readFile(staged, "utf8")).toBe("G28\nG1 X10\n");
  });

  it("lists files by name, with their size and modification time", async () => {
    await sim.upload("b.3mf", "12345");
    await sim.upload("a.gcode", "G28\n");

    const { files } = await sim.client.listFiles();

    expect(files.map(({ name, sizeBytes }) => ({ name, sizeBytes }))).toEqual([
      { name: "a.gcode", sizeBytes: 4 },
      { name: "b.3mf", sizeBytes: 5 },
    ]);
    for (const file of files) {
      expect(new Date(file.modifiedAt ?? "").toISOString()).toBe(
        file.modifiedAt,
      );
    }
  });

  it("lists nothing before the first upload", async () => {
    expect(await sim.client.listFiles()).toEqual({ files: [] });
  });

  it("accepts .gcode and .3mf in any case, and nothing else", async () => {
    for (const name of ["part.gcode", "PART.GCODE", "plate.3mf", "Plate.3MF"]) {
      await send(name);
    }
    for (const name of [
      "part.gco",
      "part.g",
      "part.bgcode",
      "part.stl",
      "part",
    ]) {
      await expect(send(name)).rejects.toMatchObject({
        code: "printer_rejected",
      });
    }
  });

  it("replaces a file of the same name", async () => {
    await sim.upload("cube.gcode", "old");
    await sim.upload("cube.gcode", "newer");

    expect(await sim.client.listFiles()).toMatchObject({
      files: [{ name: "cube.gcode", sizeBytes: 5 }],
    });
    expect(await readdir(filesDir())).toEqual(["cube.gcode"]);
  });

  it("refuses to replace the file being printed, but takes other files", async () => {
    await sim.upload("cube.gcode");
    await sim.client.startPrint({ fileName: "cube.gcode" });

    await expect(sim.upload("cube.gcode", "changed")).rejects.toMatchObject({
      code: "invalid_state",
    });
    await sim.upload("next.gcode");
    expect(await readFile(join(filesDir(), "cube.gcode"), "utf8")).toBe(
      "G28\n",
    );
  });

  it("answers file_not_found when the staged file is missing", async () => {
    await expect(
      sim.client.sendFile({
        fileName: "cube.gcode",
        sizeBytes: 4,
        path: join(sim.stagingDir, "missing.gcode"),
      }),
    ).rejects.toMatchObject({ code: "file_not_found" });
    expect(sim.all("files_changed")).toEqual([]);
  });

  it("refuses files over 1 GiB", async () => {
    const path = await sim.stage("big.gcode");

    await expect(
      sim.client.sendFile({
        fileName: "big.gcode",
        sizeBytes: MAX_UPLOAD_BYTES + 1,
        path,
      }),
    ).rejects.toMatchObject({ code: "printer_rejected" });
  });

  it("leaves no partial file behind when a copy fails", async () => {
    const notAFile = join(sim.stagingDir, "folder.gcode");
    await mkdir(notAFile);

    await expect(
      sim.client.sendFile({
        fileName: "x.gcode",
        sizeBytes: 0,
        path: notAFile,
      }),
    ).rejects.toMatchObject({ code: "internal" });
    expect(await readdir(filesDir())).toEqual([]);
  });
});

describe("file names", () => {
  const unsafe = [
    "../escape.gcode",
    "../../escape.gcode",
    "dir/part.gcode",
    "dir\\part.gcode",
    "/tmp/part.gcode",
    ".hidden.gcode",
    ".gcode",
    "..",
    "tab\there.gcode",
    "nul\u0000.gcode",
    "del\u007f.gcode",
    `${"a".repeat(250)}.gcode`, // 256 bytes
    `${"é".repeat(125)}.gcode`, // 256 bytes in UTF-8
  ];

  it.each(unsafe)("refuses to store %j", async (name) => {
    await expect(send(name)).rejects.toMatchObject({
      code: "printer_rejected",
    });
  });

  it.each(unsafe)("refuses to print %j", async (name) => {
    await expect(
      sim.client.startPrint({ fileName: name }),
    ).rejects.toMatchObject({ code: "printer_rejected" });
  });

  it("never writes outside its folder", async () => {
    await send("inside.gcode");
    for (const name of unsafe) {
      await send(name).catch(() => undefined);
    }

    expect(await readdir(sim.storageDir)).toEqual(["files"]);
    expect(await readdir(filesDir())).toEqual(["inside.gcode"]);
  });

  it("accepts a name of exactly 255 bytes", async () => {
    await send(`${"a".repeat(249)}.gcode`);

    expect((await sim.client.listFiles()).files).toHaveLength(1);
  });
});

describe("the printer's folder", () => {
  it("only lists files the printer could print", async () => {
    await sim.upload("cube.gcode");
    await writeFile(join(filesDir(), ".abc.part"), "partial");
    await writeFile(join(filesDir(), "notes.txt"), "hello");
    await mkdir(join(filesDir(), "folder.gcode"));

    expect(await sim.client.listFiles()).toMatchObject({
      files: [{ name: "cube.gcode" }],
    });
  });

  it("keeps files across a driver restart", async () => {
    await sim.upload("cube.gcode");
    const ctx: DriverContext = {
      emit: () => undefined,
      log: {
        debug: () => undefined,
        info: () => undefined,
        warn: () => undefined,
        error: () => undefined,
      },
    };
    const restarted = simulatedDriver.create(
      {
        printerId: "restarted",
        settings: simulatedSettingsSchema.parse({}),
        storageDir: sim.storageDir,
      },
      ctx,
    );
    await restarted.connect();

    expect(await restarted.listFiles()).toMatchObject({
      files: [{ name: "cube.gcode", sizeBytes: 4 }],
    });
    await restarted.startPrint({ fileName: "cube.gcode" });
    await restarted.dispose();
  });
});
