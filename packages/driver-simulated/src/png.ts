// SPDX-FileCopyrightText: 2026 Open Print Stack contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { crc32, deflateSync } from "node:zlib";

// A minimal PNG encoder: 8-bit RGB, no filtering, no interlacing. Enough for
// the simulated camera, without an image library.

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** An 8-bit RGB image: `rgb` holds width × height × 3 bytes, row by row. */
export type RgbImage = {
  readonly width: number;
  readonly height: number;
  readonly rgb: Uint8Array;
};

export function encodePng({ width, height, rgb }: RgbImage): Buffer {
  const rowBytes = width * 3;
  if (rgb.byteLength !== rowBytes * height) {
    throw new RangeError(
      `A ${width}×${height} RGB image needs ${rowBytes * height} bytes, not ${rgb.byteLength}.`,
    );
  }
  // Each row starts with its filter type: 0, unfiltered.
  const scanlines = Buffer.alloc((rowBytes + 1) * height);
  for (let y = 0; y < height; y++) {
    scanlines.set(
      rgb.subarray(y * rowBytes, (y + 1) * rowBytes),
      y * (rowBytes + 1) + 1,
    );
  }

  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; // bit depth
  header[9] = 2; // colour type: RGB
  // Compression, filter and interlace methods are all 0, the only standard ones.

  return Buffer.concat([
    SIGNATURE,
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(scanlines)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/** Length, type, data, then a CRC-32 of the type and data. */
function chunk(type: string, data: Uint8Array): Buffer {
  const typeAndData = Buffer.concat([Buffer.from(type, "latin1"), data]);
  const out = Buffer.alloc(4 + typeAndData.byteLength + 4);
  out.writeUInt32BE(data.byteLength, 0);
  typeAndData.copy(out, 4);
  out.writeUInt32BE(crc32(typeAndData), 4 + typeAndData.byteLength);
  return out;
}
