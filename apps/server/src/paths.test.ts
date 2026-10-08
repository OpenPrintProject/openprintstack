// SPDX-FileCopyrightText: 2026 Open Print Stack contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { chmod, mkdir, readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  dataPaths,
  ensureDataDirs,
  ensurePrinterDir,
  printerDir,
  removePrinterDir,
  stagedFilePath,
} from "./paths.ts";
import { tempDir } from "./test-utils.ts";

const PRINTER_ID = "0199b3a0-1c00-7000-8000-000000000001";

// Absolute on every platform: on Windows, path.resolve adds the drive.
const ROOT = path.resolve("/srv/ops");

// Windows has no Unix permission bits: Node ignores the mode when it creates a
// folder there, and chmod only sets the read-only flag, which Windows ignores
// on folders. Folders in the user's own profile get per-user access from
// Windows itself, so on Windows these tests leave the permissions unchecked.
const POSIX_MODES = process.platform !== "win32";

async function mode(file: string): Promise<number> {
  return (await stat(file)).mode & 0o777;
}

async function isFolder(file: string): Promise<boolean> {
  return (await stat(file)).isDirectory();
}

describe("dataPaths", () => {
  it("lays out the data dir", () => {
    expect(dataPaths(ROOT)).toEqual({
      root: ROOT,
      database: path.join(ROOT, "ops.sqlite"),
      printers: path.join(ROOT, "printers"),
      staging: path.join(ROOT, "staging"),
    });
  });

  it("makes the root absolute", () => {
    expect(dataPaths("ops").root).toBe(path.resolve("ops"));
  });
});

describe("ensureDataDirs", () => {
  it("creates missing folders, and their parents, as 0700", async () => {
    const parent = path.join(await tempDir(), "a", "b");
    const paths = dataPaths(path.join(parent, "ops"));

    await ensureDataDirs(paths);

    for (const dir of [parent, paths.root, paths.printers, paths.staging]) {
      expect(await isFolder(dir)).toBe(true);
      if (POSIX_MODES) expect(await mode(dir)).toBe(0o700);
    }
  });

  it("leaves existing folders' permissions alone", async () => {
    const paths = dataPaths(await tempDir());
    await mkdir(paths.printers);
    if (POSIX_MODES) {
      await chmod(paths.root, 0o750);
      await chmod(paths.printers, 0o755);
    }

    await ensureDataDirs(paths);

    expect(await isFolder(paths.staging)).toBe(true);
    if (POSIX_MODES) {
      expect(await mode(paths.root)).toBe(0o750);
      expect(await mode(paths.printers)).toBe(0o755);
      expect(await mode(paths.staging)).toBe(0o700);
    }
  });

  it("empties staging but keeps the folder and everything else", async () => {
    const paths = dataPaths(await tempDir());
    await ensureDataDirs(paths);
    await writeFile(path.join(paths.staging, "upload.gcode"), "G28");
    await mkdir(path.join(paths.staging, "partial"));
    await writeFile(path.join(paths.staging, "partial", "chunk"), "x");
    await writeFile(path.join(paths.staging, ".hidden"), "x");
    await mkdir(path.join(paths.printers, PRINTER_ID));
    await writeFile(path.join(paths.printers, PRINTER_ID, "a.gcode"), "G28");
    await writeFile(paths.database, "");

    await ensureDataDirs(paths);

    expect(await readdir(paths.staging)).toEqual([]);
    expect(await readdir(path.join(paths.printers, PRINTER_ID))).toEqual([
      "a.gcode",
    ]);
    expect((await readdir(paths.root)).sort()).toEqual([
      "ops.sqlite",
      "printers",
      "staging",
    ]);
  });

  it("refuses a data dir that is a file", async () => {
    const file = path.join(await tempDir(), "ops");
    await writeFile(file, "");

    await expect(ensureDataDirs(dataPaths(file))).rejects.toThrow(
      `${file} exists but isn't a folder.`,
    );
  });

  it("refuses a data dir inside a file", async () => {
    const file = path.join(await tempDir(), "ops");
    await writeFile(file, "");

    await expect(
      ensureDataDirs(dataPaths(path.join(file, "data"))),
    ).rejects.toThrow("exists but isn't a folder.");
  });

  // Root can read and write anything, so this only runs as a normal user, and
  // not on Windows, where chmod can't take away the right to write to a folder.
  it.skipIf(process.getuid?.() === 0 || !POSIX_MODES)(
    "refuses a data dir this user can't write to",
    async () => {
      const paths = dataPaths(await tempDir());
      await ensureDataDirs(paths);
      await chmod(paths.root, 0o500);
      try {
        await expect(ensureDataDirs(paths)).rejects.toThrow(
          `The data dir ${paths.root} isn't readable and writable by this user.`,
        );
      } finally {
        await chmod(paths.root, 0o700);
      }
    },
  );
});

describe("printerDir", () => {
  const paths = dataPaths(ROOT);

  it("is the printer's id inside printers/", () => {
    expect(printerDir(paths, PRINTER_ID)).toBe(
      path.join(ROOT, "printers", PRINTER_ID),
    );
  });

  it.each([
    "",
    ".",
    "..",
    "../x",
    "printer-1",
    "a/b",
    `${PRINTER_ID}/..`,
    `../${PRINTER_ID}`,
    `${PRINTER_ID}\0`,
    ` ${PRINTER_ID}`,
  ])("refuses %j, which isn't a UUID", (id) => {
    expect(() => printerDir(paths, id)).toThrow(
      `Not a printer id: ${JSON.stringify(id)}`,
    );
  });
});

describe("stagedFilePath", () => {
  const paths = dataPaths(ROOT);

  it("is the id inside staging/", () => {
    expect(stagedFilePath(paths, PRINTER_ID)).toBe(
      path.join(ROOT, "staging", PRINTER_ID),
    );
  });

  it.each(["", "..", "../ops.sqlite", "benchy.gcode", `${PRINTER_ID}/..`])(
    "refuses %j, which isn't a UUID",
    (id) => {
      expect(() => stagedFilePath(paths, id)).toThrow(
        `Not a staged file id: ${JSON.stringify(id)}`,
      );
    },
  );
});

describe("ensurePrinterDir and removePrinterDir", () => {
  it("creates the folder as 0700, and again is fine", async () => {
    const paths = dataPaths(await tempDir());
    await ensureDataDirs(paths);

    const dir = await ensurePrinterDir(paths, PRINTER_ID);
    await writeFile(path.join(dir, "a.gcode"), "G28");
    expect(await ensurePrinterDir(paths, PRINTER_ID)).toBe(dir);

    expect(dir).toBe(path.join(paths.printers, PRINTER_ID));
    if (POSIX_MODES) expect(await mode(dir)).toBe(0o700);
    expect(await readdir(dir)).toEqual(["a.gcode"]);
  });

  it("removes the folder and everything in it, and only that", async () => {
    const paths = dataPaths(await tempDir());
    await ensureDataDirs(paths);
    const other = "0199b3a0-1c00-7000-8000-000000000002";
    const dir = await ensurePrinterDir(paths, PRINTER_ID);
    await mkdir(path.join(dir, "files"));
    await writeFile(path.join(dir, "files", "a.gcode"), "G28");
    await ensurePrinterDir(paths, other);

    await removePrinterDir(paths, PRINTER_ID);

    expect(await readdir(paths.printers)).toEqual([other]);
  });

  it("is fine when the folder is already gone", async () => {
    const paths = dataPaths(await tempDir());
    await ensureDataDirs(paths);

    await expect(removePrinterDir(paths, PRINTER_ID)).resolves.toBeUndefined();
  });

  it("refuses a bad id without deleting anything", async () => {
    const paths = dataPaths(await tempDir());
    await ensureDataDirs(paths);

    await expect(removePrinterDir(paths, "..")).rejects.toThrow(
      'Not a printer id: ".."',
    );
    await expect(ensurePrinterDir(paths, "../x")).rejects.toThrow(
      'Not a printer id: "../x"',
    );
    expect((await readdir(paths.root)).sort()).toEqual(["printers", "staging"]);
  });
});
