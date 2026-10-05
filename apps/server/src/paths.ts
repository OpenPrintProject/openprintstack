// SPDX-FileCopyrightText: 2026 Open Print Stack contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { constants } from "node:fs";
import { access, mkdir, readdir, rm } from "node:fs/promises";
import path from "node:path";

import { z } from "zod";

// Everything the server stores lives under one data dir:
//
//   ops.sqlite       the database (plus its -wal and -shm files)
//   printers/<id>/   one folder per printer: its driver's storageDir
//   staging/         uploads, before the driver copies them

export type DataPaths = {
  readonly root: string;
  readonly database: string;
  readonly printers: string;
  readonly staging: string;
};

/** Only your user can open the folders the server creates. */
const DIR_MODE = 0o700;

export function dataPaths(dataDir: string): DataPaths {
  const root = path.resolve(dataDir);
  return Object.freeze({
    root,
    database: path.join(root, "ops.sqlite"),
    printers: path.join(root, "printers"),
    staging: path.join(root, "staging"),
  });
}

/**
 * Creates the data dir, `printers/` and `staging/` if they're missing, and
 * empties `staging/`. Folders it creates are 0700; folders that already exist
 * keep their permissions. Run before the server starts listening.
 */
export async function ensureDataDirs(paths: DataPaths): Promise<void> {
  for (const dir of [paths.root, paths.printers, paths.staging]) {
    await makeDir(dir);
  }
  try {
    await access(paths.root, constants.R_OK | constants.W_OK | constants.X_OK);
  } catch {
    throw new Error(
      `The data dir ${paths.root} isn't readable and writable by this user.`,
    );
  }
  // Nothing can be uploading before the server listens, so anything here was
  // left by an upload that a crash or restart interrupted.
  for (const entry of await readdir(paths.staging)) {
    await rm(path.join(paths.staging, entry), { recursive: true, force: true });
  }
}

const PrinterId = z.uuid();

/**
 * The folder for one printer's driver. Printer ids are UUIDs, and anything
 * else is refused, so an id like `../x` can't point outside `printers/`.
 */
export function printerDir(paths: DataPaths, printerId: string): string {
  if (!PrinterId.safeParse(printerId).success) {
    throw new Error(`Not a printer id: ${JSON.stringify(printerId)}`);
  }
  return path.join(paths.printers, printerId);
}

/** Creates the printer's folder (0700) if it's missing, and returns it. */
export async function ensurePrinterDir(
  paths: DataPaths,
  printerId: string,
): Promise<string> {
  const dir = printerDir(paths, printerId);
  await makeDir(dir);
  return dir;
}

/** Deletes the printer's folder and everything in it, if it exists. */
export async function removePrinterDir(
  paths: DataPaths,
  printerId: string,
): Promise<void> {
  await rm(printerDir(paths, printerId), { recursive: true, force: true });
}

async function makeDir(dir: string): Promise<void> {
  try {
    await mkdir(dir, { recursive: true, mode: DIR_MODE });
  } catch (error) {
    if (
      isErrnoException(error) &&
      ["EEXIST", "ENOTDIR"].includes(error.code ?? "")
    ) {
      throw new Error(`${dir} exists but isn't a folder.`, { cause: error });
    }
    throw error;
  }
}

function isErrnoException(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
