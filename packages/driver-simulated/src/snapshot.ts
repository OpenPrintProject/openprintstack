// SPDX-FileCopyrightText: 2026 Open Print Stack contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { encodePng } from "./png.ts";
import type { MachineStatus } from "./printer.ts";

// The simulated camera's picture: the background colour shows the status, and
// a bar along the bottom fills with the job's progress. There are no fonts, so
// there is no text.

export const SNAPSHOT_SIZE = { width: 640, height: 480 } as const;

export type Rgb = readonly [number, number, number];

export const STATUS_COLOURS: Readonly<Record<MachineStatus, Rgb>> = {
  idle: [107, 114, 128], // grey
  busy: [124, 58, 237], // violet
  preparing: [234, 88, 12], // orange
  printing: [37, 99, 235], // blue
  pausing: [217, 119, 6], // amber
  paused: [217, 119, 6],
  cancelling: [71, 85, 105], // slate
  error: [220, 38, 38], // red
};

/** Only drawn while there is a job. */
export const PROGRESS_BAR = {
  x: 32,
  y: 432,
  width: 576,
  height: 24,
  track: [31, 41, 55] as Rgb,
  fill: [255, 255, 255] as Rgb,
} as const;

/** A PNG of the printer, with a progress bar if `progressPercent` isn't null. */
export function renderSnapshot(
  status: MachineStatus,
  progressPercent: number | null,
): Buffer {
  const { width, height } = SNAPSHOT_SIZE;
  const rgb = new Uint8Array(width * height * 3);
  const fill = (x: number, y: number, w: number, h: number, colour: Rgb) => {
    for (let row = y; row < y + h; row++) {
      for (let column = x; column < x + w; column++) {
        rgb.set(colour, (row * width + column) * 3);
      }
    }
  };

  fill(0, 0, width, height, STATUS_COLOURS[status]);
  if (progressPercent !== null) {
    const bar = PROGRESS_BAR;
    const percent = Math.min(Math.max(progressPercent, 0), 100);
    fill(bar.x, bar.y, bar.width, bar.height, bar.track);
    fill(
      bar.x,
      bar.y,
      Math.round((bar.width * percent) / 100),
      bar.height,
      bar.fill,
    );
  }
  return encodePng({ width, height, rgb });
}
