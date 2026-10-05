// SPDX-FileCopyrightText: 2026 Open Print Stack contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { randomUUID } from "node:crypto";
import { copyFile, mkdir, readdir, rename, rm, stat } from "node:fs/promises";
import { join } from "node:path";

import { DriverError } from "@openprintstack/driver-sdk";
import type { PrinterFile } from "@openprintstack/protocol";

import { ACCEPTED_EXTENSIONS, MAX_UPLOAD_BYTES } from "./capabilities.ts";

/** The longest name most file systems accept, in UTF-8 bytes. */
const MAX_NAME_BYTES = 255;

/** Why `name` can't be a file on the printer, or null if it can. */
function fileNameProblem(name: string): string | null {
  if (name.length === 0) {
    return "it is empty";
  }
  if (Buffer.byteLength(name) > MAX_NAME_BYTES) {
    return `it is longer than ${MAX_NAME_BYTES} bytes`;
  }
  // Also rules out "." and "..", and the store's own temporary files.
  if (name.startsWith(".")) {
    return "it starts with a dot";
  }
  for (const char of name) {
    const code = char.codePointAt(0) ?? 0;
    if (char === "/" || char === "\\" || code < 0x20 || code === 0x7f) {
      return "it contains a slash, a backslash or a control character";
    }
  }
  const lower = name.toLowerCase();
  if (!ACCEPTED_EXTENSIONS.some((extension) => lower.endsWith(extension))) {
    return `it doesn't end with ${ACCEPTED_EXTENSIONS.join(" or ")}`;
  }
  return null;
}

/**
 * Refuses a name that isn't a plain file name with an accepted extension, so
 * that no name can reach outside the printer's folder.
 */
export function checkFileName(name: string): void {
  const problem = fileNameProblem(name);
  if (problem !== null) {
    throw new DriverError(
      "printer_rejected",
      `${JSON.stringify(name)} can't be used as a file name: ${problem}.`,
    );
  }
}

function isMissing(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "ENOENT"
  );
}

/**
 * The printer's files, kept in a `files` folder in its storage directory, so
 * they survive restarts. Callers check names with `checkFileName` first.
 */
export class FileStore {
  readonly #dir: string;

  constructor(storageDir: string) {
    this.#dir = join(storageDir, "files");
  }

  async list(): Promise<PrinterFile[]> {
    let names: string[];
    try {
      const entries = await readdir(this.#dir, { withFileTypes: true });
      names = entries
        .filter(
          (entry) => entry.isFile() && fileNameProblem(entry.name) === null,
        )
        .map((entry) => entry.name)
        .sort();
    } catch (error) {
      if (isMissing(error)) {
        return [];
      }
      throw error;
    }
    return Promise.all(
      names.map(async (name) => {
        const info = await stat(join(this.#dir, name));
        return {
          name,
          sizeBytes: info.size,
          modifiedAt: info.mtime.toISOString(),
        };
      }),
    );
  }

  async has(name: string): Promise<boolean> {
    try {
      return (await stat(join(this.#dir, name))).isFile();
    } catch (error) {
      if (isMissing(error)) {
        return false;
      }
      throw error;
    }
  }

  /**
   * Copies a staged file in as `name`, replacing any file of that name. The
   * staged file is left where it is.
   */
  async add(name: string, stagedPath: string): Promise<void> {
    let sizeBytes: number;
    try {
      sizeBytes = (await stat(stagedPath)).size;
    } catch (error) {
      if (isMissing(error)) {
        throw new DriverError(
          "file_not_found",
          `There is no staged file at ${stagedPath}.`,
          { cause: error },
        );
      }
      throw error;
    }
    if (sizeBytes > MAX_UPLOAD_BYTES) {
      throw new DriverError(
        "printer_rejected",
        `The file is ${sizeBytes} bytes; the printer takes at most ${MAX_UPLOAD_BYTES}.`,
      );
    }

    await mkdir(this.#dir, { recursive: true });
    // Copied under a hidden name and then renamed, so a half-copied file is
    // never listed and a replaced file is never half-written.
    const partial = join(this.#dir, `.${randomUUID()}.part`);
    try {
      await copyFile(stagedPath, partial);
      await rename(partial, join(this.#dir, name));
    } catch (error) {
      await rm(partial, { force: true });
      throw error;
    }
  }
}
