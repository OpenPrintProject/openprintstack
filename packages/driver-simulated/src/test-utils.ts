// SPDX-FileCopyrightText: 2026 Open Print Stack contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

// Helpers for this package's tests. Not exported from the package.

import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { crc32, inflateSync } from "node:zlib";

import {
  type DriverMessage,
  type DriverMessageOf,
  reduceTelemetry,
} from "@openprintstack/driver-sdk";
import {
  createDriverHarness,
  type DriverHarness,
} from "@openprintstack/driver-sdk/testing";
import {
  emptyTelemetry,
  type PrinterStatus,
  type Telemetry,
} from "@openprintstack/protocol";
import { vi } from "vitest";
import type { z } from "zod";

import { TICK_MS } from "./driver.ts";
import simulatedDriver from "./index.ts";
import type { simulatedSettingsSchema } from "./settings.ts";

export type SettingsInput = z.input<typeof simulatedSettingsSchema>;

/** A simulated printer behind the cloning loopback, as the host runs it. */
export type Sim = DriverHarness & {
  /** Where `stage` writes files, as the server's staging folder. */
  readonly stagingDir: string;
  /** Advances fake timers by `count` ticks. */
  tick(count?: number): Promise<void>;
  /** Writes a file to the staging folder and returns its path. */
  stage(name: string, contents?: string): Promise<string>;
  /** Stages a file and sends it to the printer. */
  upload(name: string, contents?: string): Promise<void>;
  /** The telemetry the host has merged from every message so far. */
  telemetry(): Telemetry;
  /** The last status reported. */
  status(): PrinterStatus | undefined;
  /** The messages from `from` on, without logs. */
  since(from: number): DriverMessage[];
  /** The messages of one type, in order. */
  all<T extends DriverMessage["type"]>(type: T): DriverMessageOf<T>[];
};

/** Creates a simulated printer. Tests call `vi.useFakeTimers()` first. */
export async function createSim(settings: SettingsInput = {}): Promise<Sim> {
  const harness = await createDriverHarness(simulatedDriver, { settings });
  const stagingDir = await mkdtemp(join(tmpdir(), "ops-staging-"));

  const stage = async (name: string, contents = "G28\n") => {
    const path = join(stagingDir, name);
    await writeFile(path, contents);
    return path;
  };

  return {
    ...harness,
    stagingDir,
    async tick(count = 1) {
      await vi.advanceTimersByTimeAsync(TICK_MS * count);
    },
    stage,
    async upload(name, contents = "G28\n") {
      const path = await stage(name, contents);
      await harness.client.sendFile({
        fileName: name,
        sizeBytes: Buffer.byteLength(contents),
        path,
      });
    },
    telemetry: () => harness.messages.reduce(reduceTelemetry, emptyTelemetry()),
    status: () => harness.statuses().at(-1),
    since: (from) =>
      harness.messages.slice(from).filter((message) => message.type !== "log"),
    all: <T extends DriverMessage["type"]>(type: T) =>
      harness.messages.filter(
        (message): message is DriverMessageOf<T> => message.type === type,
      ),
    async close() {
      await harness.close();
      await rm(stagingDir, { recursive: true, force: true });
    },
  };
}

export type DecodedPng = {
  width: number;
  height: number;
  bitDepth: number;
  colourType: number;
  chunkTypes: string[];
  pixel(x: number, y: number): [number, number, number];
};

/**
 * Decodes an unfiltered 8-bit RGB PNG, checking its signature, chunk CRCs and
 * scanline filters. Written from the PNG spec rather than from `png.ts`, so it
 * can catch mistakes there.
 */
export function decodePng(data: Uint8Array): DecodedPng {
  const bytes = Buffer.from(data.buffer, data.byteOffset, data.byteLength);
  const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (!signature.every((byte, index) => bytes[index] === byte)) {
    throw new Error("Not a PNG signature.");
  }

  const chunks: { type: string; body: Buffer }[] = [];
  let offset = 8;
  while (offset < bytes.length) {
    const length = bytes.readUInt32BE(offset);
    const type = bytes.toString("latin1", offset + 4, offset + 8);
    const body = bytes.subarray(offset + 8, offset + 8 + length);
    const crc = bytes.readUInt32BE(offset + 8 + length);
    if (crc !== crc32(bytes.subarray(offset + 4, offset + 8 + length))) {
      throw new Error(`The ${type} chunk's CRC is wrong.`);
    }
    chunks.push({ type, body });
    offset += 12 + length;
  }

  const header = chunks[0];
  if (header?.type !== "IHDR" || chunks.at(-1)?.type !== "IEND") {
    throw new Error("A PNG starts with IHDR and ends with IEND.");
  }
  const width = header.body.readUInt32BE(0);
  const height = header.body.readUInt32BE(4);
  const rowBytes = width * 3;
  const scanlines = inflateSync(
    Buffer.concat(
      chunks
        .filter((chunk) => chunk.type === "IDAT")
        .map((chunk) => chunk.body),
    ),
  );
  if (scanlines.length !== (rowBytes + 1) * height) {
    throw new Error(`Expected ${(rowBytes + 1) * height} bytes of scanlines.`);
  }
  for (let y = 0; y < height; y++) {
    if (scanlines[y * (rowBytes + 1)] !== 0) {
      throw new Error(`Row ${y} isn't unfiltered.`);
    }
  }

  return {
    width,
    height,
    bitDepth: header.body[8] ?? -1,
    colourType: header.body[9] ?? -1,
    chunkTypes: chunks.map((chunk) => chunk.type),
    pixel(x, y) {
      const start = y * (rowBytes + 1) + 1 + x * 3;
      return [
        scanlines[start] ?? -1,
        scanlines[start + 1] ?? -1,
        scanlines[start + 2] ?? -1,
      ];
    },
  };
}
