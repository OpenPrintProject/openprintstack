// SPDX-FileCopyrightText: 2026 Open Print Stack contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

// A printer's secrets (its write-only settings, such as an access code) go in
// through the API and reach the driver, but never come back out: not in an
// API response, an event or a log line, even when the driver itself puts
// them in what it sends.

import { DriverError } from "@openprintstack/driver-sdk";
import { describe, expect, it } from "vitest";

import { TEST_DRIVER_TYPE } from "../drivers/test-driver.ts";
import { testApp } from "./test-app.ts";

const SECRET = "s3cret-c0de";
const NEW_SECRET = "n3w-s3cret";

describe("a printer's secrets", () => {
  it("never appear in an API response, an event or a log line", async () => {
    const t = await testApp();
    const { token } = await t.setupAdmin();
    // A careless driver, putting its access code in everything it sends.
    t.drivers.handle("connect", (_, driver) => {
      const code = driver.init.settings.accessCode ?? "";
      driver.emit({
        type: "log",
        level: "info",
        message: `Connecting with ${code}`,
        data: { url: `mqtt://elegoo:${code}@printer.local`, code },
      });
      driver.emit({
        type: "status",
        status: "idle",
        detail: `Signed in with ${code}`,
        error: null,
      });
      driver.emit({
        type: "alert",
        severity: "info",
        code: "signed_in",
        message: `Code ${code} accepted`,
      });
    });
    for (const op of ["home", "listFiles"] as const) {
      t.drivers.handle(op, (_, driver) => {
        throw new DriverError(
          "printer_rejected",
          `Code ${driver.init.settings.accessCode} isn't allowed to do that`,
        );
      });
    }
    const bodies: string[] = [];
    const send = async (
      method: string,
      path: string,
      json?: unknown,
    ): Promise<unknown> => {
      const response = await t.call(method, path, { token, json });
      const text = await response.text();
      bodies.push(text);
      return text === "" ? undefined : JSON.parse(text);
    };

    const { id } = (await send("POST", "/api/printers", {
      name: "CC2",
      driverType: TEST_DRIVER_TYPE,
      settings: { accessCode: SECRET },
    })) as { id: string };
    const reads = async () => {
      for (const path of [
        "/api/driver-types",
        "/api/printers",
        `/api/printers/${id}`,
        `/api/printers/${id}/config`,
        `/api/printers/${id}/files`,
      ]) {
        await send("GET", path);
      }
      await send("POST", `/api/printers/${id}/commands`, {
        kind: "motion.home",
        axes: [],
      });
    };
    await reads();
    // Blank keeps it; an invalid edit is refused; a new value replaces it.
    await send("PATCH", `/api/printers/${id}`, {
      settings: { accessCode: "" },
    });
    await send("PATCH", `/api/printers/${id}`, {
      settings: { accessCode: NEW_SECRET, nozzleMaxC: -1 },
    });
    const replaced = await send("PATCH", `/api/printers/${id}`, {
      name: "Elegoo",
      settings: { accessCode: NEW_SECRET },
    });
    await reads();

    // The driver got each secret, so it had them to leak.
    expect(t.drivers.created.map((each) => each.init.settings)).toEqual([
      expect.objectContaining({ accessCode: SECRET }),
      expect.objectContaining({ accessCode: NEW_SECRET }),
    ]);
    expect(replaced).toMatchObject({
      name: "Elegoo",
      secretsSet: ["accessCode"],
      settingsVersion: 2,
    });
    const events = JSON.stringify(t.events);
    const logs = t.logs.lines.join("");
    expect(events).toContain("Signed in with [Redacted]");
    expect(logs).toContain("mqtt://elegoo:[Redacted]@printer.local");
    expect(bodies.join("\n")).toContain("isn't allowed to do that");
    for (const secret of [SECRET, NEW_SECRET]) {
      expect(bodies.join("\n")).not.toContain(secret);
      expect(events).not.toContain(secret);
      expect(logs).not.toContain(secret);
    }
  });
});
