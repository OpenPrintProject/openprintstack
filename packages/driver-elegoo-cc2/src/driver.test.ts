// SPDX-FileCopyrightText: 2026 Open Print Stack contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

import {
  createDriverHarness,
  type DriverHarness,
} from "@openprintstack/driver-sdk/testing";
import { connect } from "mqtt";
import { describe, expect, it, onTestFinished } from "vitest";

import { JOBS_FILE, OFFLINE_ERRORS } from "./driver.ts";
import { createElegooCc2Driver } from "./index.ts";
import type { JsonObject } from "./protocol.ts";
import { mergeStatus } from "./status-feed.ts";
import { FakeCc2, type FakeCc2Options } from "./testing/index.ts";
import { lastStatus, sent, TEST_TIMINGS, until } from "./test-utils.ts";

// The driver against the fake CC2 on loopback, through the cloning loopback
// as the host runs it. Real timers, with the short TEST_TIMINGS.

const UUID = "b52af24c-764e-4092-8a50-00e5f8f02b46";

type Setup = {
  fake: FakeCc2;
  harness: DriverHarness;
};

async function setup(
  options: FakeCc2Options = {},
  accessCode?: string,
): Promise<Setup> {
  const fake = await FakeCc2.start(options);
  const module = createElegooCc2Driver({
    ports: fake.ports,
    timings: TEST_TIMINGS,
  });
  const harness = await createDriverHarness(module, {
    settings: { host: fake.host, accessCode: accessCode ?? fake.accessCode },
  });
  onTestFinished(async () => {
    await harness.close();
    await fake.close();
  });
  return { fake, harness };
}

/** Sets up and connects, waiting until the printer is reported idle. */
async function connected(options?: FakeCc2Options): Promise<Setup> {
  const result = await setup(options);
  await result.harness.client.connect();
  expect(lastStatus(result.harness)?.status).toBe("idle");
  return result;
}

function statusIs(harness: DriverHarness, status: string, detail?: string) {
  return () => {
    const last = lastStatus(harness);
    return (
      last?.status === status &&
      (detail === undefined || last.detail === detail) &&
      last
    );
  };
}

function requestsFor(fake: FakeCc2, method: number) {
  return fake.requests.filter((request) => request.method === method);
}

/** What the printer reports while printing, merged into its status. */
function printing(sub: number, extra: JsonObject = {}): JsonObject {
  return mergeStatus(
    {
      machine_status: { status: 2, sub_status: sub, progress: 10 },
      print_status: {
        filename: "benchy.gcode",
        uuid: UUID,
        current_layer: 12,
        total_layer: 100,
        print_duration: 600,
        remaining_time_sec: 5400,
        progress: 10,
      },
    },
    extra,
  );
}

describe("connecting", { timeout: 20_000 }, () => {
  it("registers once, asks for the full status, and reports everything", async () => {
    const { fake, harness } = await connected();

    const types = harness.messages
      .filter((message) => message.type !== "log")
      .map((message) => message.type);
    expect(types).toEqual(["capabilities", "status", "job", "telemetry"]);
    expect(lastStatus(harness)).toEqual({
      type: "status",
      status: "idle",
      detail: null,
      error: null,
    });
    expect(sent(harness, "telemetry")[0]?.telemetry).toMatchObject({
      temperatures: {
        nozzle: { actualC: 26.4, targetC: 0 },
        bed: { actualC: 25.1, targetC: 0 },
        chamber: { actualC: 27, targetC: null },
      },
      fans: { part: { percent: 0 }, mainboard: { percent: 100 } },
      speedPercent: 100,
      position: { x: 0, y: 0, z: 0 },
      homedAxes: [],
    });
    expect(fake.registered).toHaveLength(1);
    expect(fake.clients).toEqual(fake.registered);
    expect(fake.registered[0]).toMatch(/^0cli[0-9a-f]{6}$/);
    expect(requestsFor(fake, 1002)).toHaveLength(1);
    expect(harness.protocolErrors).toEqual([]);
  });

  it("logs in as elegoo with the access code", async () => {
    // The fake refuses anything else, so connecting at all shows it.
    const { harness } = await connected({ accessCode: "s3cret" });

    expect(lastStatus(harness)?.status).toBe("idle");
  });

  it("sends a PING often enough to stay registered", async () => {
    const { fake, harness } = await connected({ heartbeatTimeoutMs: 600 });
    const [clientId] = fake.registered;

    await sleep(1500);

    expect(fake.clients).toEqual([clientId]);
    expect(lastStatus(harness)?.status).toBe("idle");
  });

  it("closes cleanly on disconnect, freeing its place on the printer", async () => {
    const { fake, harness } = await connected();

    await harness.client.disconnect();

    expect(lastStatus(harness)).toEqual({
      type: "status",
      status: "offline",
      detail: null,
      error: null,
    });
    await until("the printer to drop the client", () =>
      fake.clients.length === 0 ? true : undefined,
    );
  });

  it("connects again after a disconnect", async () => {
    const { fake, harness } = await connected();
    await harness.client.disconnect();

    await harness.client.connect();

    expect(lastStatus(harness)?.status).toBe("idle");
    expect(fake.registered).toHaveLength(2);
  });
});

describe("when it can't connect", { timeout: 20_000 }, () => {
  it("reports no answer from a printer that's off, and connects once it's on", async () => {
    const { fake, harness } = await setup();
    fake.setDown(true);

    await harness.client.connect();

    expect(lastStatus(harness)).toEqual({
      type: "status",
      status: "offline",
      detail: "No answer from 127.0.0.1. Retrying.",
      error: null,
    });
    fake.setDown(false);
    await until("idle", statusIs(harness, "idle"));
  });

  it("reports a wrong access code, and keeps trying", async () => {
    const { fake, harness } = await setup({}, "wrong-code");

    await harness.client.connect();

    expect(lastStatus(harness)).toEqual({
      type: "status",
      status: "offline",
      detail: "Retrying.",
      error: OFFLINE_ERRORS.accessCodeRejected,
    });
    // Someone sets the printer's code to the one we have.
    fake.accessCode = "wrong-code";
    await until("idle", statusIs(harness, "idle"));
  });

  it("reports too many clients, and connects once a place is free", async () => {
    const { fake, harness } = await setup({ maxClients: 4 });
    fake.occupy(4);

    await harness.client.connect();

    expect(lastStatus(harness)).toEqual({
      type: "status",
      status: "offline",
      detail: "Retrying.",
      error: OFFLINE_ERRORS.tooManyClients,
    });
    expect(fake.clients).toEqual([]);
    fake.occupy(3);
    await until("idle", statusIs(harness, "idle"));
  });

  it("says when LAN Only mode is off, and connects once it's on", async () => {
    const { fake, harness } = await setup({ lanOnly: false });

    await harness.client.connect();

    expect(lastStatus(harness)?.error).toEqual(OFFLINE_ERRORS.lanOnlyOff);
    expect(fake.registered).toEqual([]);
    fake.lanOnly = true;
    await until("idle", statusIs(harness, "idle"));
  });

  it("says when the printer has no access code, and never tries the default one", async () => {
    const { fake, harness } = await setup({
      accessCodeSet: false,
      accessCode: "123456",
    });

    await harness.client.connect();

    expect(lastStatus(harness)?.error).toEqual(OFFLINE_ERRORS.noAccessCode);
    expect(fake.registered).toEqual([]);
  });

  it("finishes the first attempt in time when the printer never answers the registration", async () => {
    const { fake, harness } = await setup();
    fake.setSilent(true);
    const started = Date.now();

    await harness.client.connect();

    expect(Date.now() - started).toBeLessThan(TEST_TIMINGS.attemptMs + 500);
    expect(lastStatus(harness)?.status).toBe("offline");
  });

  it("stops at once when disposed while waiting for the registration", async () => {
    const { fake, harness } = await setup();
    fake.setSilent(true);
    const connecting = harness.client.connect();
    await until("the login", () => fake.connections === 1);
    await sleep(100);
    const started = Date.now();

    await harness.client.dispose();

    expect(Date.now() - started).toBeLessThan(TEST_TIMINGS.registerMs / 2);
    await connecting.catch(() => undefined);
  });

  it("reports the same failure only once while it keeps trying", async () => {
    const { fake, harness } = await setup();
    fake.setDown(true);

    await harness.client.connect();
    await sleep(1000);

    expect(sent(harness, "status").map((message) => message.status)).toEqual([
      "offline",
    ]);
  });
});

describe("staying connected", { timeout: 20_000 }, () => {
  it("goes offline when the printer stops answering, and comes back with it", async () => {
    const { fake, harness } = await connected();

    fake.setSilent(true);
    await until(
      "offline",
      statusIs(
        harness,
        "offline",
        "The printer stopped answering. Reconnecting.",
      ),
    );
    fake.setSilent(false);

    await until("idle", statusIs(harness, "idle"));
  });

  it("goes offline when the PONGs stop, even if the connection stays up", async () => {
    // A printer that's busy may stop answering PINGs before its socket closes.
    const { fake, harness } = await connected();

    fake.answerPings = false;

    await until(
      "offline",
      statusIs(
        harness,
        "offline",
        "The printer stopped answering. Reconnecting.",
      ),
    );
  });

  it("counts status updates as the printer answering", async () => {
    const { fake, harness } = await connected();
    fake.answerPings = false;

    // For longer than the silence limit.
    for (let i = 0; i < 25; i++) {
      fake.update({ extruder: { temperature: 30 + i } });
      await sleep(100);
    }

    expect(sent(harness, "status").map((message) => message.status)).toEqual([
      "idle",
    ]);
  });

  it("reconnects after a reboot, and asks for the full status again", async () => {
    const { fake, harness } = await connected();

    fake.dropConnections();
    await until(
      "offline",
      statusIs(
        harness,
        "offline",
        "Lost the connection to the printer. Reconnecting.",
      ),
    );
    await until("idle", statusIs(harness, "idle"));

    expect(requestsFor(fake, 1002)).toHaveLength(2);
    expect(fake.registered).toHaveLength(2);
    // It reported everything again, as the host forgets telemetry offline.
    const capabilities = sent(harness, "capabilities");
    expect(capabilities).toHaveLength(2);
    expect(sent(harness, "telemetry").at(-1)?.telemetry).toHaveProperty(
      "temperatures",
    );
  });

  it("keeps working alongside another client, and ignores its echoes", async () => {
    const { fake, harness } = await connected();
    const slicer = connect({
      host: fake.host,
      port: fake.ports.mqtt,
      clientId: "1_PC_4521",
      username: "elegoo",
      password: fake.accessCode,
      reconnectPeriod: 0,
    });
    onTestFinished(() => {
      slicer.end(true);
    });
    await new Promise((resolve) => slicer.once("connect", resolve));
    const prefix = `elegoo/${fake.serial}`;
    await slicer.subscribeAsync([
      `${prefix}/1_PC_4521_req/register_response`,
      `${prefix}/1_PC_4521/api_response`,
    ]);
    const answers: unknown[] = [];
    slicer.on("message", (_topic, payload) =>
      answers.push(JSON.parse(payload.toString())),
    );

    await slicer.publishAsync(
      `${prefix}/api_register`,
      JSON.stringify({ client_id: "1_PC_4521", request_id: "1_PC_4521_req" }),
    );
    await slicer.publishAsync(
      `${prefix}/1_PC_4521/api_request`,
      JSON.stringify({ id: 1, method: 1002, params: {} }),
    );
    await until("the slicer's answers", () => answers.length >= 2);

    expect(answers[0]).toEqual({ client_id: "1_PC_4521", error: "ok" });
    expect(fake.clients).toHaveLength(2);
    // The printer passed the slicer's messages on to us; we ignored them.
    expect(harness.protocolErrors).toEqual([]);
    expect(lastStatus(harness)?.status).toBe("idle");
    fake.update({ heater_bed: { target: 60 } });
    await until("the bed's target", () =>
      sent(harness, "telemetry").some(
        (message) => message.telemetry.temperatures?.bed?.targetC === 60,
      ),
    );
  });

  it("doesn't count another client's echoes as the printer answering", async () => {
    const { fake, harness } = await connected();
    fake.setSilent(true);

    // Another client keeps sending requests, which the printer passes on.
    const timer = setInterval(() => {
      fake.publish(`elegoo/${fake.serial}/1_PC_4521/api_request`, {
        type: "PING",
      });
      fake.publish(`elegoo/${fake.serial}/api_register`, {
        client_id: "1_PC_4521",
        request_id: "x",
      });
    }, 50);
    onTestFinished(() => clearInterval(timer));

    await until(
      "offline",
      statusIs(
        harness,
        "offline",
        "The printer stopped answering. Reconnecting.",
      ),
    );
  });

  it("ignores nonsense from the printer", async () => {
    const { fake, harness } = await connected();
    const status = `elegoo/${fake.serial}/api_status`;

    fake.publish(status, "not an object");
    fake.publish(status, { id: 1, method: 6000 });
    fake.publish(status, { id: 2, method: 6001, result: {} });
    fake.update({ heater_bed: { target: 60 } });

    await until("the bed's target", () =>
      sent(harness, "telemetry").some(
        (message) => message.telemetry.temperatures?.bed?.targetC === 60,
      ),
    );
    expect(lastStatus(harness)?.status).toBe("idle");
    expect(harness.protocolErrors).toEqual([]);
  });
});

describe("status deltas", { timeout: 20_000 }, () => {
  it("reports only what a delta changed", async () => {
    const { fake, harness } = await connected();
    const before = harness.messages.length;

    fake.update({ extruder: { target: 220 } });

    const patch = await until("a telemetry patch", () =>
      harness.messages
        .slice(before)
        .find((message) => message.type === "telemetry"),
    );
    expect(patch).toEqual({
      type: "telemetry",
      telemetry: {
        temperatures: {
          nozzle: { actualC: 26.4, targetC: 220 },
          bed: { actualC: 25.1, targetC: 0 },
          chamber: { actualC: 27, targetC: null },
        },
      },
    });
  });

  it("asks for the full status again after 5 skipped ids in a row", async () => {
    const { fake, harness } = await connected();
    // The first delta sets where the sequence is.
    fake.update({ extruder: { temperature: 30 } });

    for (let i = 1; i <= 5; i++) {
      fake.loseDeltas(1);
      fake.update({ heater_bed: { target: i * 10 } });
      fake.update({ extruder: { temperature: 30 + i } });
    }

    await until("a second full status", () =>
      requestsFor(fake, 1002).length === 2 ? true : undefined,
    );
    // The full status brings what the lost deltas carried.
    await until("the bed's target from the full status", () =>
      sent(harness, "telemetry").some(
        (message) => message.telemetry.temperatures?.bed?.targetC === 50,
      ),
    );
  });

  it("doesn't ask again for a gap or two", async () => {
    const { fake, harness } = await connected();

    for (let i = 1; i <= 4; i++) {
      fake.loseDeltas(1);
      fake.update({ heater_bed: { target: i } });
      fake.update({ extruder: { temperature: 30 + i } });
      fake.update({ extruder: { temperature: 40 + i } });
    }
    await until("the last delta", () =>
      sent(harness, "telemetry").some(
        (message) => message.telemetry.temperatures?.nozzle?.actualC === 44,
      ),
    );

    expect(requestsFor(fake, 1002)).toHaveLength(1);
  });
});

describe("jobs", { timeout: 20_000 }, () => {
  it("reports a print from start to finish", async () => {
    const { fake, harness } = await connected();
    const before = harness.messages.length;

    fake.update(printing(1045));
    await until("preparing", statusIs(harness, "preparing"));
    fake.update(printing(2075, { print_status: { progress: 50 } }));
    await until("printing", statusIs(harness, "printing"));
    fake.update({ machine_status: { sub_status: 2077, progress: 100 } });
    await until("idle", statusIs(harness, "idle"));

    const reported = harness.messages
      .slice(before)
      .filter((message) => message.type !== "telemetry");
    expect(reported).toEqual([
      { type: "job_lifecycle", event: "started", fileName: "benchy.gcode" },
      {
        type: "job",
        job: {
          fileName: "benchy.gcode",
          progressPercent: 10,
          elapsedS: 600,
          remainingS: 5400,
          currentLayer: 12,
          totalLayers: 100,
        },
      },
      {
        type: "status",
        status: "preparing",
        detail: "Heating the nozzle",
        error: null,
      },
      {
        type: "job",
        job: expect.objectContaining({ progressPercent: 50 }) as unknown,
      },
      { type: "status", status: "printing", detail: null, error: null },
      { type: "job_lifecycle", event: "completed", fileName: "benchy.gcode" },
      { type: "job", job: null },
      { type: "status", status: "idle", detail: null, error: null },
    ]);
  });

  it.each([
    [{ machine_status: { sub_status: 2504 } }, "cancelled", "idle"],
    [{ machine_status: { status: 14 } }, "failed", "error"],
  ] as const)("ends a print with %j as %s", async (delta, outcome, status) => {
    const { fake, harness } = await connected();
    fake.update(printing(2075));
    await until("printing", statusIs(harness, "printing"));

    fake.update(delta);

    await until(outcome, () =>
      sent(harness, "job_lifecycle").find(
        (message) => message.event === outcome,
      ),
    );
    await until(status, statusIs(harness, status));
  });

  it("remembers the job in the printer's folder", async () => {
    const { fake, harness } = await connected();

    const file = join(harness.storageDir, JOBS_FILE);
    const read = async () =>
      JSON.parse(await readFile(file, "utf8").catch(() => "null")) as unknown;

    fake.update(printing(2075));
    expect(
      await until("the job in memory", async () => {
        const memory = await read();
        return JSON.stringify(memory).includes(UUID) && memory;
      }),
    ).toEqual({
      job: { uuid: UUID, fileName: "benchy.gcode" },
      endedUuid: null,
    });

    fake.update({ machine_status: { sub_status: 2077 } });
    expect(
      await until("the job ended in memory", async () => {
        const memory = (await read()) as { job: unknown } | null;
        return memory?.job === null && memory;
      }),
    ).toEqual({ job: null, endedUuid: UUID });
  });

  it("doesn't announce a job again after a restart mid-print", async () => {
    const { fake, harness } = await setup({ status: printing(2075) });
    await writeFile(
      join(harness.storageDir, JOBS_FILE),
      JSON.stringify({
        job: { uuid: UUID, fileName: "benchy.gcode" },
        endedUuid: null,
      }),
    );

    await harness.client.connect();
    expect(lastStatus(harness)?.status).toBe("printing");
    fake.update({ machine_status: { sub_status: 2077 } });
    await until("idle", statusIs(harness, "idle"));

    expect(sent(harness, "job_lifecycle")).toEqual([
      { type: "job_lifecycle", event: "completed", fileName: "benchy.gcode" },
    ]);
  });

  it("ends as failed a job that ended unseen, and says why in the log", async () => {
    const { harness } = await setup();
    await writeFile(
      join(harness.storageDir, JOBS_FILE),
      JSON.stringify({
        job: { uuid: UUID, fileName: "benchy.gcode" },
        endedUuid: null,
      }),
    );

    await harness.client.connect();

    expect(sent(harness, "job_lifecycle")).toEqual([
      { type: "job_lifecycle", event: "failed", fileName: "benchy.gcode" },
    ]);
    expect(sent(harness, "log")).toContainEqual(
      expect.objectContaining({
        level: "warn",
        message: expect.stringContaining("didn't say how") as unknown,
      }),
    );
  });

  it("starts afresh when the job memory can't be read", async () => {
    const { harness } = await setup({ status: printing(2075) });
    await writeFile(join(harness.storageDir, JOBS_FILE), "{ broken");

    await harness.client.connect();

    expect(sent(harness, "job_lifecycle")).toEqual([
      { type: "job_lifecycle", event: "started", fileName: "benchy.gcode" },
    ]);
  });

  it("takes the layer count from the file's details when the status leaves it out", async () => {
    const { fake, harness } = await connected({
      fileLayers: { "benchy.gcode": 722 },
    });

    fake.update(printing(2075, { print_status: { total_layer: 0 } }));

    await until("the layer count", () =>
      sent(harness, "job").some((message) => message.job?.totalLayers === 722),
    );
    expect(requestsFor(fake, 1046)).toEqual([
      expect.objectContaining({
        params: { storage_media: "local", filename: "benchy.gcode" },
      }),
    ]);
  });
});

describe("problem codes", { timeout: 20_000 }, () => {
  it("raises an alert for each new code and shows the codes as the error", async () => {
    const { fake, harness } = await connected();
    fake.update(printing(2075));
    await until("printing", statusIs(harness, "printing"));

    fake.update({
      machine_status: { sub_status: 2502, exception_status: [109] },
    });
    await until("paused", statusIs(harness, "paused"));
    expect(lastStatus(harness)?.error).toEqual({
      code: "printer_exception",
      message: "Filament ran out (109).",
    });
    expect(sent(harness, "alert")).toEqual([
      {
        type: "alert",
        severity: "warning",
        code: "cc2_exception_109",
        message: "Filament ran out (109).",
      },
    ]);

    // Still there: no new alert. Gone: no error.
    fake.update({ machine_status: { progress: 11 } });
    fake.update({ machine_status: { exception_status: [] } });
    await until("no error", () =>
      lastStatus(harness)?.error === null ? true : undefined,
    );
    expect(lastStatus(harness)?.status).toBe("paused");
    expect(sent(harness, "alert")).toHaveLength(1);

    // Back again: a new alert.
    fake.update({ machine_status: { exception_status: [109] } });
    await until("a second alert", () =>
      sent(harness, "alert").length === 2 ? true : undefined,
    );
  });
});
