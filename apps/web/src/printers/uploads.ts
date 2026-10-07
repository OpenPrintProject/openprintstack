// SPDX-FileCopyrightText: 2026 Open Print Stack contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { Capabilities } from "@openprintstack/protocol";

import { formatBytes } from "./format.ts";

// What the browser checks before uploading a file, as the server does before
// reading its body: the printer's file types and its size limit.

const disjunction = new Intl.ListFormat("en-GB", { type: "disjunction" });

/** Why the printer won't take the file, or null if it will. */
export function uploadProblem(
  file: { name: string; size: number },
  files: Capabilities["files"],
  printerName: string,
): string | null {
  const { acceptedExtensions, maxUploadBytes } = files;
  // An empty list means the printer takes any file.
  const name = file.name.toLowerCase();
  if (
    acceptedExtensions.length > 0 &&
    !acceptedExtensions.some((extension) =>
      name.endsWith(extension.toLowerCase()),
    )
  ) {
    return `${printerName} only takes ${disjunction.format(acceptedExtensions)} files.`;
  }
  if (maxUploadBytes !== null && file.size > maxUploadBytes) {
    const [size, max] = twoSizes(file.size, maxUploadBytes);
    return `${file.name} is ${size}; ${printerName} takes at most ${max}.`;
  }
  return null;
}

const bytes = new Intl.NumberFormat("en-GB");

/** Both sizes, in exact bytes when rounding would show them the same. */
function twoSizes(a: number, b: number): [string, string] {
  const rounded: [string, string] = [formatBytes(a), formatBytes(b)];
  if (rounded[0] !== rounded[1]) return rounded;
  return [`${bytes.format(a)} bytes`, `${bytes.format(b)} bytes`];
}

/** The file picker's `accept`: the printer's extensions, or anything. */
export function acceptAttribute(
  files: Capabilities["files"],
): string | undefined {
  return files.acceptedExtensions.length === 0
    ? undefined
    : files.acceptedExtensions.join(",");
}
