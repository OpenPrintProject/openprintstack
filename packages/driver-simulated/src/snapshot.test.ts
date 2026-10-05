// SPDX-FileCopyrightText: 2026 Open Print Stack contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { encodePng } from "./png.ts";
import type { MachineStatus } from "./printer.ts";
import {
  PROGRESS_BAR,
  renderSnapshot,
  SNAPSHOT_SIZE,
  STATUS_COLOURS,
} from "./snapshot.ts";
import { createSim, decodePng, type Sim } from "./test-utils.ts";

describe("encodePng", () => {
  it("writes an 8-bit RGB PNG that decodes to the same pixels", () => {
    const rgb = new Uint8Array([
      ...[255, 0, 0, 0, 255, 0], // red, green
      ...[0, 0, 255, 255, 255, 255], // blue, white
    ]);
    const png = decodePng(encodePng({ width: 2, height: 2, rgb }));

    expect(png).toMatchObject({
      width: 2,
      height: 2,
      bitDepth: 8,
      colourType: 2,
      chunkTypes: ["IHDR", "IDAT", "IEND"],
    });
    expect([
      png.pixel(0, 0),
      png.pixel(1, 0),
      png.pixel(0, 1),
      png.pixel(1, 1),
    ]).toEqual([
      [255, 0, 0],
      [0, 255, 0],
      [0, 0, 255],
      [255, 255, 255],
    ]);
  });

  it("refuses pixel data of the wrong length", () => {
    expect(() =>
      encodePng({ width: 2, height: 2, rgb: new Uint8Array(11) }),
    ).toThrow(RangeError);
  });
});

describe("renderSnapshot", () => {
  const statuses = Object.keys(STATUS_COLOURS) as MachineStatus[];
  const barY = PROGRESS_BAR.y + 1;

  it.each(statuses)("fills the picture with the %s colour", (status) => {
    const png = decodePng(renderSnapshot(status, null));

    expect([png.width, png.height]).toEqual([
      SNAPSHOT_SIZE.width,
      SNAPSHOT_SIZE.height,
    ]);
    for (const [x, y] of [
      [0, 0],
      [639, 479],
      [320, barY], // no bar without a job
    ] as const) {
      expect(png.pixel(x, y)).toEqual(STATUS_COLOURS[status]);
    }
  });

  it("gives each status its own colour, except pausing and paused", () => {
    const colours = new Set(
      statuses
        .filter((status) => status !== "pausing")
        .map((status) => STATUS_COLOURS[status].join()),
    );
    expect(colours.size).toBe(statuses.length - 1);
  });

  it.each([
    [0, 0],
    [50, 288],
    [100, 576],
  ])("fills %i %% of the progress bar", (percent, filled) => {
    const png = decodePng(renderSnapshot("printing", percent));
    const { x, width, track, fill } = PROGRESS_BAR;

    if (filled > 0) {
      expect(png.pixel(x, barY)).toEqual(fill);
      expect(png.pixel(x + filled - 1, barY)).toEqual(fill);
    }
    if (filled < width) {
      expect(png.pixel(x + filled, barY)).toEqual(track);
      expect(png.pixel(x + width - 1, barY)).toEqual(track);
    }
    expect(png.pixel(x - 1, barY)).toEqual(STATUS_COLOURS.printing);
    expect(png.pixel(x + width, barY)).toEqual(STATUS_COLOURS.printing);
  });
});

describe("the camera", () => {
  let sim: Sim;

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(async () => {
    expect(sim.protocolErrors).toEqual([]);
    await sim.close();
    vi.useRealTimers();
  });

  it("lists one camera whose snapshot shows the status and progress", async () => {
    sim = await createSim({ printDurationS: 10, heatUpS: 2 });
    await sim.client.connect();

    expect(await sim.client.listCameras()).toEqual({
      cameras: [{ id: "main", label: "Simulated camera" }],
    });
    const idle = await sim.client.getSnapshot({ cameraId: "main" });
    expect(idle.mimeType).toBe("image/png");
    expect(decodePng(idle.data).pixel(0, 0)).toEqual(STATUS_COLOURS.idle);

    await sim.upload("cube.gcode");
    await sim.client.startPrint({ fileName: "cube.gcode" });
    await sim.tick(4 + 10);
    const printing = decodePng(
      (await sim.client.getSnapshot({ cameraId: "main" })).data,
    );
    expect(printing.pixel(0, 0)).toEqual(STATUS_COLOURS.printing);
    const { x, y, fill, track } = PROGRESS_BAR;
    expect(printing.pixel(x + 287, y)).toEqual(fill);
    expect(printing.pixel(x + 288, y)).toEqual(track);
  });

  it("refuses an unknown camera", async () => {
    sim = await createSim();
    await sim.client.connect();

    await expect(
      sim.client.getSnapshot({ cameraId: "side" }),
    ).rejects.toMatchObject({ code: "not_supported" });
  });

  it("has no camera when cameraEnabled is false", async () => {
    sim = await createSim({ cameraEnabled: false });
    await sim.client.connect();

    expect(await sim.client.listCameras()).toEqual({ cameras: [] });
    expect(sim.all("capabilities").at(-1)?.capabilities.cameras).toEqual({
      snapshot: false,
      stream: false,
    });
    await expect(
      sim.client.getSnapshot({ cameraId: "main" }),
    ).rejects.toMatchObject({ code: "not_supported" });
  });

  it("can't take a snapshot while offline", async () => {
    sim = await createSim();
    await sim.client.connect();
    await sim.client.disconnect();

    await expect(
      sim.client.getSnapshot({ cameraId: "main" }),
    ).rejects.toMatchObject({ code: "offline" });
  });
});
