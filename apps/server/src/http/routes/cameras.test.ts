// SPDX-FileCopyrightText: 2026 Open Print Stack contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { DriverError } from "@openprintstack/driver-sdk";
import { describe, expect, it } from "vitest";

import { apiError, testApp } from "../test-app.ts";

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

async function withPrinter(driverType?: string) {
  const t = await testApp();
  const { token } = await t.setupAdmin();
  const id = await t.addPrinter(token, "Bench", {}, driverType);
  return { ...t, token, id };
}

describe("GET /api/printers/{id}/cameras", () => {
  it("answers the driver's cameras", async () => {
    const t = await withPrinter();
    t.drivers.latest(t.id).handle("listCameras", () => ({
      cameras: [{ id: "main", label: "Main" }],
    }));

    const answer = await t.call("GET", `/api/printers/${t.id}/cameras`, {
      token: t.token,
    });

    expect(answer.status).toBe(200);
    expect(await answer.json()).toEqual({
      cameras: [{ id: "main", label: "Main" }],
    });
  });
});

describe("GET /api/printers/{id}/cameras/{cameraId}/snapshot", () => {
  it("serves the image with the driver's type, nosniff and no-store", async () => {
    const t = await withPrinter();

    const answer = await t.call(
      "GET",
      `/api/printers/${t.id}/cameras/main/snapshot`,
      { token: t.token },
    );

    expect(answer.status).toBe(200);
    expect(answer.headers.get("content-type")).toBe("image/png");
    expect(answer.headers.get("x-content-type-options")).toBe("nosniff");
    expect(answer.headers.get("cache-control")).toBe("no-store");
    expect([...new Uint8Array(await answer.arrayBuffer())]).toEqual(
      PNG_SIGNATURE,
    );
    expect(t.drivers.latest(t.id).calls.at(-1)).toEqual({
      op: "getSnapshot",
      args: { cameraId: "main" },
    });
  });

  it("uses whatever image type the driver gives", async () => {
    const t = await withPrinter();
    t.drivers.latest(t.id).handle("getSnapshot", () => ({
      mimeType: "image/jpeg",
      data: new Uint8Array([0xff, 0xd8, 0xff]),
    }));

    const answer = await t.call(
      "GET",
      `/api/printers/${t.id}/cameras/main/snapshot`,
      { token: t.token },
    );

    expect(answer.headers.get("content-type")).toBe("image/jpeg");
    expect([...new Uint8Array(await answer.arrayBuffer())]).toEqual([
      0xff, 0xd8, 0xff,
    ]);
  });

  it("serves the real simulator's PNG", async () => {
    const t = await withPrinter("simulated");

    const answer = await t.call(
      "GET",
      `/api/printers/${t.id}/cameras/main/snapshot`,
      { token: t.token },
    );

    expect(answer.status).toBe(200);
    expect(answer.headers.get("content-type")).toBe("image/png");
    const bytes = new Uint8Array(await answer.arrayBuffer());
    expect([...bytes.slice(0, 8)]).toEqual(PNG_SIGNATURE);
  });

  it.each([
    ["not_supported", 422, "unsupported"],
    ["offline", 409, "printer_offline"],
    ["timeout", 504, "timeout"],
  ] as const)(
    "answers the driver's %s with %i %s",
    async (driverCode, status, code) => {
      const t = await withPrinter();
      t.drivers.latest(t.id).handle("getSnapshot", () => {
        throw new DriverError(driverCode, "No picture.");
      });

      const answer = await t.call(
        "GET",
        `/api/printers/${t.id}/cameras/main/snapshot`,
        { token: t.token },
      );

      expect(answer.status).toBe(status);
      expect(await apiError(answer)).toEqual({ code, message: "No picture." });
    },
  );

  it("answers an unknown printer with 404", async () => {
    const t = await withPrinter();

    const answer = await t.call(
      "GET",
      "/api/printers/nope/cameras/main/snapshot",
      { token: t.token },
    );

    expect(answer.status).toBe(404);
  });
});
