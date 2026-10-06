// SPDX-FileCopyrightText: 2026 Open Print Stack contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  DriverError,
  type DriverMessage,
  type DriverModule,
} from "@openprintstack/driver-sdk";
import {
  type Capabilities,
  emptyTelemetry,
  type OpsEvent,
  type PrinterStatus,
  Telemetry,
} from "@openprintstack/protocol";
import { telemetryFixture } from "@openprintstack/protocol/fixtures";
import { afterEach, describe, expect, it, vi } from "vitest";

import { EventBus } from "../bus/bus.ts";
import { StateStore } from "../state/store.ts";
import { debugLogger, jsonLines, settle, tempDir } from "../test-utils.ts";
import {
  CALL_TIMEOUT_MS,
  DriverHost,
  type DriverHostOptions,
  type DriverRun,
  DriverStartError,
  PROTOCOL_ALERT_INTERVAL_MS,
  START_FAILED_DETAIL,
} from "./host.ts";
import {
  testCapabilities,
  TestDrivers,
  testSettingsSchema,
} from "./test-driver.ts";

const PRINTER_ID = "printer-1";
const driverSource = { kind: "driver" } as const;
const systemSource = { kind: "system" } as const;

afterEach(() => {
  vi.useRealTimers();
});

function status(
  to: PrinterStatus,
  detail: string | null = null,
): DriverMessage {
  return { type: "status", status: to, detail, error: null };
}

async function setup(options: Partial<DriverHostOptions> = {}) {
  const { logger, output } = await debugLogger();
  const drivers = new TestDrivers();
  const store = new StateStore({
    lookupPrinter: () => ({ name: "Test", driverType: "test" }),
    logger,
  });
  const bus = new EventBus({ store, logger });
  const events: OpsEvent[] = [];
  bus.subscribe("test", (event) => events.push(event));
  const host = new DriverHost({
    printerId: PRINTER_ID,
    bus,
    logger,
    ...options,
  });
  const storageDir = await tempDir();

  /** A prepare step that starts the test driver with these settings. */
  const run =
    (settings: unknown = {}, module: DriverModule = drivers.module) =>
    (): Promise<DriverRun> =>
      Promise.resolve({
        module,
        settings: testSettingsSchema.parse(settings),
        storageDir,
      });

  /** Starts the test driver and returns it, with the events so far cleared. */
  const started = async () => {
    await host.start(run());
    events.length = 0;
    return drivers.latest(PRINTER_ID);
  };

  /** What each event says, without the envelope fields the bus stamps. */
  const published = () =>
    events.map(({ type, source, payload }) => ({ type, source, payload }));

  const logs = () => jsonLines(output);
  const rawLogs = () => output.lines;

  /** Each status change as [previous, status]. */
  const transitions = () =>
    events.flatMap((event) =>
      event.type === "printer.status_changed"
        ? [[event.payload.previous, event.payload.status]]
        : [],
    );

  return {
    bus,
    drivers,
    events,
    host,
    logs,
    published,
    rawLogs,
    transitions,
    run,
    started,
    storageDir,
    store,
  };
}

describe("DriverHost.start", () => {
  it("publishes connecting, then the initial capabilities, before creating the driver", async () => {
    const { bus, drivers, host, published, run } = await setup();
    const createdBefore: number[] = [];
    bus.subscribe("probe", () => createdBefore.push(drivers.created.length));

    await host.start(run({ nozzleMaxC: 280 }));

    expect(published()).toEqual([
      {
        type: "printer.status_changed",
        source: systemSource,
        payload: {
          previous: null,
          status: "connecting",
          detail: null,
          error: null,
        },
      },
      {
        type: "printer.capabilities_changed",
        source: systemSource,
        payload: {
          capabilities: testCapabilities(
            testSettingsSchema.parse({ nozzleMaxC: 280 }),
          ),
        },
      },
      {
        type: "printer.status_changed",
        source: driverSource,
        payload: {
          previous: "connecting",
          status: "idle",
          detail: null,
          error: null,
        },
      },
    ]);
    expect(createdBefore).toEqual([0, 0, 1]);
    expect(host.status).toBe("idle");
    expect(host.running).toBe(true);
  });

  it("creates the driver with its printer id, parsed settings and folder", async () => {
    const { drivers, host, run, storageDir } = await setup();

    await host.start(run({ nozzleMaxC: 280 }));

    expect(drivers.latest(PRINTER_ID).init).toEqual({
      printerId: PRINTER_ID,
      settings: { nozzleMaxC: 280, failCreate: false },
      storageDir,
    });
    expect(drivers.latest(PRINTER_ID).ops()).toEqual(["connect"]);
  });

  it("resolves only once the first connect attempt is over", async () => {
    const { drivers, host, run } = await setup();
    let finish = () => {};
    drivers.handle(
      "connect",
      () => new Promise<void>((resolve) => (finish = resolve)),
    );
    let resolved = false;

    const starting = host.start(run()).then(() => (resolved = true));
    await settle();
    expect(resolved).toBe(false);

    finish();
    await starting;
    expect(resolved).toBe(true);
  });

  it("refuses to start a driver that is already running", async () => {
    const { host, run } = await setup();
    await host.start(run());

    await expect(host.start(run())).rejects.toThrow(
      "The driver for printer-1 is already running.",
    );
  });

  it("refuses to start while a start is in progress", async () => {
    const { drivers, host, run } = await setup();
    drivers.handle("connect", () => new Promise(() => {}));
    void host.start(run());
    await settle();

    await expect(host.start(run())).rejects.toThrow("already running");
  });

  it("starts again after a stop, with a new driver", async () => {
    const { drivers, host, run, transitions } = await setup();
    await host.start(run());
    await host.stop();

    await host.start(run({ nozzleMaxC: 300 }));

    expect(drivers.created).toHaveLength(2);
    expect(drivers.created[0]?.disposed).toBe(true);
    expect(transitions()).toEqual([
      [null, "connecting"],
      ["connecting", "idle"],
      ["idle", "offline"],
      ["offline", "connecting"],
      ["connecting", "idle"],
    ]);
  });
});

describe("DriverHost.start when the driver can't run", () => {
  /** The events after `connecting`, and whether a driver is running. */
  async function failedStart(
    prepare: (
      context: Awaited<ReturnType<typeof setup>>,
    ) => () => Promise<DriverRun>,
  ) {
    const context = await setup();
    await context.host.start(prepare(context));
    return context;
  }

  function offline(code: string, message: string) {
    return {
      type: "printer.status_changed",
      source: systemSource,
      payload: {
        previous: "connecting",
        status: "offline",
        detail: START_FAILED_DETAIL,
        error: { code, message },
      },
    };
  }

  it("goes offline with the reason when preparing fails", async () => {
    const { drivers, host, logs, published } = await failedStart(
      () => () =>
        Promise.reject(
          new DriverStartError(
            "unknown_driver_type",
            'There is no driver type "nope".',
          ),
        ),
    );

    expect(published().slice(1)).toEqual([
      offline("unknown_driver_type", 'There is no driver type "nope".'),
    ]);
    expect(drivers.created).toEqual([]);
    expect(host.running).toBe(false);
    expect(host.status).toBe("offline");
    expect(logs().at(-1)).toMatchObject({
      level: "error",
      component: "driver-host",
      printerId: PRINTER_ID,
      code: "unknown_driver_type",
      msg: "The driver couldn't start",
    });
  });

  it("reports any other failure while preparing as driver_failed", async () => {
    const { published } = await failedStart(
      () => () => Promise.reject(new Error("The disk is full.")),
    );

    expect(published().slice(1)).toEqual([
      offline("driver_failed", "The disk is full."),
    ]);
  });

  it("refuses invalid initial capabilities, publishing none", async () => {
    const { published } = await failedStart(({ drivers, run }) =>
      run(
        {},
        {
          ...drivers.module,
          initialCapabilities: () => ({}) as Capabilities,
        },
      ),
    );

    expect(published().map((event) => event.type)).toEqual([
      "printer.status_changed",
      "printer.status_changed",
    ]);
    expect(published()[1]?.payload).toMatchObject({
      status: "offline",
      error: { code: "driver_failed" },
    });
    expect(JSON.stringify(published()[1]?.payload)).toContain(
      "The driver's initial capabilities are invalid.",
    );
  });

  it("goes offline when the driver can't be created", async () => {
    const { host, published } = await failedStart(({ run }) =>
      run({ failCreate: true }),
    );

    expect(published().slice(2)).toEqual([
      offline(
        "driver_failed",
        "The driver couldn't be created: The test driver was told not to start.",
      ),
    ]);
    expect(host.running).toBe(false);
  });

  it("disposes a driver whose connect fails, without retrying", async () => {
    const { drivers, host, published } = await failedStart(
      ({ drivers, run }) => {
        drivers.handle("connect", () => {
          throw new DriverError("internal", "The socket library crashed.");
        });
        return run();
      },
    );

    expect(published().slice(2)).toEqual([
      offline(
        "driver_failed",
        "The driver couldn't connect: The socket library crashed.",
      ),
    ]);
    expect(drivers.latest(PRINTER_ID).ops()).toEqual(["connect", "dispose"]);
    expect(host.running).toBe(false);
    await expect(
      host.call({ op: "pause", args: {} }, CALL_TIMEOUT_MS),
    ).rejects.toMatchObject({ code: "offline" });
  });

  it("gives up on a connect that takes over 10 s", async () => {
    vi.useFakeTimers({ toNotFake: ["setImmediate", "clearImmediate"] });
    const { drivers, host, published, run } = await setup();
    drivers.handle("connect", () => new Promise(() => {}));

    const starting = host.start(run());
    await vi.advanceTimersByTimeAsync(CALL_TIMEOUT_MS - 1);
    expect(published()).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(1);
    await starting;

    expect(published().slice(2)).toEqual([
      offline(
        "driver_failed",
        `The driver couldn't connect: The driver didn't answer "connect" within ${CALL_TIMEOUT_MS} ms.`,
      ),
    ]);
    expect(drivers.latest(PRINTER_ID).ops()).toEqual(["connect", "dispose"]);
  });

  it("can start again once the problem is fixed", async () => {
    const { host, published, run } = await failedStart(({ run }) =>
      run({ failCreate: true }),
    );

    await host.start(run());

    expect(host.running).toBe(true);
    expect(published().at(-1)?.payload).toMatchObject({
      previous: "connecting",
      status: "idle",
    });
  });
});

describe("DriverHost: driver messages become events", () => {
  const alert: DriverMessage = {
    type: "alert",
    severity: "warning",
    code: "filament_runout",
    message: "Filament ran out.",
  };
  const capabilities = {
    ...testCapabilities(testSettingsSchema.parse({})),
    extensions: ["test", "other"],
  };

  it.each<[string, DriverMessage, Pick<OpsEvent, "type" | "payload">]>([
    [
      "status",
      {
        type: "status",
        status: "error",
        detail: "Thermal runaway",
        error: { code: "heater", message: "The nozzle is too hot." },
      },
      {
        type: "printer.status_changed",
        payload: {
          previous: "idle",
          status: "error",
          detail: "Thermal runaway",
          error: { code: "heater", message: "The nozzle is too hot." },
        },
      },
    ],
    [
      "job started",
      { type: "job_lifecycle", event: "started", fileName: "a.gcode" },
      { type: "printer.job_started", payload: { fileName: "a.gcode" } },
    ],
    ...(["completed", "cancelled", "failed"] as const).map(
      (
        outcome,
      ): [string, DriverMessage, Pick<OpsEvent, "type" | "payload">] => [
        `job ${outcome}`,
        { type: "job_lifecycle", event: outcome, fileName: "a.gcode" },
        {
          type: "printer.job_ended",
          payload: { outcome, fileName: "a.gcode" },
        },
      ],
    ),
    [
      "files changed",
      { type: "files_changed" },
      { type: "printer.files_changed", payload: {} },
    ],
    [
      "alert",
      alert,
      {
        type: "printer.alert",
        payload: {
          severity: "warning",
          code: "filament_runout",
          message: "Filament ran out.",
        },
      },
    ],
    [
      "new capabilities",
      { type: "capabilities", capabilities },
      { type: "printer.capabilities_changed", payload: { capabilities } },
    ],
  ])("%s", async (_, message, expected) => {
    const { published, started } = await setup();
    const driver = await started();

    driver.emit(message);
    await settle();

    expect(published()).toEqual([{ ...expected, source: driverSource }]);
  });

  it("fills in previous from the last status, and publishes repeats", async () => {
    const { started, transitions } = await setup();
    const driver = await started();

    for (const to of ["printing", "paused", "paused", "offline"] as const) {
      driver.emit(status(to));
    }
    await settle();

    expect(transitions()).toEqual([
      ["idle", "printing"],
      ["printing", "paused"],
      ["paused", "paused"],
      ["paused", "offline"],
    ]);
  });

  it("publishes the full merged telemetry for each patch and job", async () => {
    const { published, started, store } = await setup();
    const driver = await started();
    const { temperatures, fans, job } = telemetryFixture;

    driver.emit({ type: "telemetry", telemetry: { temperatures } });
    driver.emit({ type: "telemetry", telemetry: { fans, speedPercent: 90 } });
    driver.emit({ type: "job", job });
    await settle();

    const empty = emptyTelemetry();
    const expected: Telemetry[] = [
      { ...empty, temperatures },
      { ...empty, temperatures, fans, speedPercent: 90 },
      { ...empty, temperatures, fans, speedPercent: 90, job },
    ];
    expect(published()).toEqual(
      expected.map((telemetry) => ({
        type: "printer.telemetry",
        source: driverSource,
        payload: { telemetry },
      })),
    );
    expect(store.get(PRINTER_ID)?.state.telemetry).toEqual(expected[2]);
  });

  it("publishes nothing for an empty patch", async () => {
    const { published, started } = await setup();
    const driver = await started();

    driver.emit({ type: "telemetry", telemetry: {} });
    await settle();

    expect(published()).toEqual([]);
  });

  it("starts from nothing after the printer goes offline", async () => {
    const { published, started } = await setup();
    const driver = await started();
    driver.emit({ type: "telemetry", telemetry: telemetryFixture });

    driver.emit(status("offline"));
    driver.emit(status("idle"));
    driver.emit({ type: "telemetry", telemetry: { speedPercent: 100 } });
    await settle();

    expect(published().at(-1)?.payload).toEqual({
      telemetry: { ...emptyTelemetry(), speedPercent: 100 },
    });
  });

  it("starts from nothing after a restart", async () => {
    const { drivers, host, published, run, started } = await setup();
    // Without the driver's own offline, only `connecting` can reset it.
    drivers.handle("disconnect", () => {});
    const driver = await started();
    driver.emit({ type: "telemetry", telemetry: telemetryFixture });
    await settle();

    await host.stop();
    await host.start(run());
    drivers.latest(PRINTER_ID).emit({
      type: "telemetry",
      telemetry: { speedPercent: 100 },
    });
    await settle();

    expect(published().at(-1)?.payload).toEqual({
      telemetry: { ...emptyTelemetry(), speedPercent: 100 },
    });
  });

  it("publishes capabilities only when they change", async () => {
    const { published, started } = await setup();
    const driver = await started();
    const initial = testCapabilities(testSettingsSchema.parse({}));
    const changed = { ...initial, maxMoveSpeedMmS: 99 };

    driver.emit({ type: "capabilities", capabilities: initial });
    driver.emit({ type: "capabilities", capabilities: changed });
    driver.emit({ type: "capabilities", capabilities: { ...changed } });
    await settle();

    expect(published()).toEqual([
      {
        type: "printer.capabilities_changed",
        source: driverSource,
        payload: { capabilities: changed },
      },
    ]);
  });

  it("accepts a job that ended while the printer was offline", async () => {
    const { published, started } = await setup();
    const driver = await started();
    driver.emit({
      type: "job_lifecycle",
      event: "started",
      fileName: "a.gcode",
    });
    driver.emit(status("printing"));
    driver.emit(status("offline", "Simulated disconnect."));

    driver.emit(status("idle"));
    driver.emit({
      type: "job_lifecycle",
      event: "completed",
      fileName: "a.gcode",
    });
    await settle();

    expect(published().slice(-2)).toEqual([
      {
        type: "printer.status_changed",
        source: driverSource,
        payload: {
          previous: "offline",
          status: "idle",
          detail: null,
          error: null,
        },
      },
      {
        type: "printer.job_ended",
        source: driverSource,
        payload: { outcome: "completed", fileName: "a.gcode" },
      },
    ]);
  });

  it("writes log messages to the server's log, not the bus", async () => {
    const { logs, published, started } = await setup();
    const driver = await started();
    const before = logs().length;
    const levels = ["debug", "info", "warn", "error"] as const;

    for (const level of levels) {
      driver.emit({
        type: "log",
        level,
        message: `A ${level} line.`,
        data: { attempt: 2, settings: { apiKey: "secret" } },
      });
    }
    driver.emit({ type: "log", level: "info", message: "No data." });
    await settle();

    expect(published()).toEqual([]);
    const lines = logs().slice(before);
    expect(lines).toHaveLength(5);
    levels.forEach((level, index) => {
      expect(lines[index]).toMatchObject({
        level,
        component: "driver",
        printerId: PRINTER_ID,
        attempt: 2,
        settings: "[Redacted]",
        msg: `A ${level} line.`,
      });
    });
    expect(lines[4]).toMatchObject({
      level: "info",
      component: "driver",
      printerId: PRINTER_ID,
      msg: "No data.",
    });
  });

  it("drops log data that would clash with the line's own fields", async () => {
    const { logs, rawLogs, started } = await setup();
    const driver = await started();
    const before = logs().length;

    driver.emit({
      type: "log",
      level: "info",
      message: "Spoofed?",
      data: {
        printerId: "printer-2",
        level: "fatal",
        time: 0,
        pid: 1,
        msg: "Something else",
        component: "auth",
        attempt: 3,
      },
    });
    await settle();

    const lines = logs().slice(before);
    expect(lines[0]).toEqual({
      level: "info",
      time: expect.any(String) as string,
      pid: process.pid,
      component: "driver",
      printerId: PRINTER_ID,
      attempt: 3,
      msg: "Spoofed?",
    });
    // JSON.parse keeps the last of two equal keys, so check the raw line.
    const raw = rawLogs()[before] ?? "";
    for (const key of [
      "level",
      "time",
      "pid",
      "msg",
      "component",
      "printerId",
    ]) {
      expect(raw.split(`"${key}":`)).toHaveLength(2);
    }
    expect(lines[1]).toMatchObject({
      level: "debug",
      component: "driver-host",
      keys: ["level", "time", "pid", "msg", "component", "printerId"],
      msg: "Dropped driver log fields that clash with the line's own",
    });
  });

  it("keeps going when publishing a message fails", async () => {
    const { logger, output } = await debugLogger();
    const drivers = new TestDrivers();
    const store = new StateStore({
      lookupPrinter: () => ({ name: "Test", driverType: "test" }),
      logger,
    });
    const bus = new EventBus({ store, logger });
    const types: string[] = [];
    bus.subscribe("record", (event) => types.push(event.type));
    const host = new DriverHost({
      printerId: PRINTER_ID,
      logger,
      bus: {
        publish(draft) {
          if (draft.type === "printer.files_changed") {
            throw new Error("The bus is broken.");
          }
          return bus.publish(draft);
        },
      },
    });
    await host.start(() =>
      Promise.resolve({
        module: drivers.module,
        settings: testSettingsSchema.parse({}),
        storageDir: "/nowhere",
      }),
    );
    const driver = drivers.latest(PRINTER_ID);

    driver.emit({ type: "files_changed" });
    driver.emit({ type: "telemetry", telemetry: { speedPercent: 100 } });
    await settle();

    expect(types.at(-1)).toBe("printer.telemetry");
    expect(jsonLines(output).at(-1)).toMatchObject({
      level: "error",
      component: "driver-host",
      messageType: "files_changed",
      err: { message: "The bus is broken." },
      msg: "Couldn't publish a driver message; dropped it",
    });
  });
});

describe("DriverHost: malformed driver messages", () => {
  const ALERT_MESSAGE =
    "The driver sent a message the server couldn't read. The server log has the details.";

  it("raises an alert and logs the problem, but not what was sent", async () => {
    const { logs, published, started } = await setup();
    const driver = await started();

    driver.emitUnchecked({
      type: "status",
      status: "exploded",
      note: "MARKER",
    });
    await settle();

    expect(published()).toEqual([
      {
        type: "printer.alert",
        source: systemSource,
        payload: {
          severity: "error",
          code: "driver_protocol_error",
          message: ALERT_MESSAGE,
        },
      },
    ]);
    const line = logs().find(
      (entry) =>
        entry.msg === "The driver sent a message the server couldn't read",
    );
    expect(line).toMatchObject({
      level: "warn",
      component: "driver-host",
      printerId: PRINTER_ID,
    });
    expect(String(line?.problem)).toContain(
      "The driver sent an invalid message.",
    );
    expect(JSON.stringify(logs())).not.toContain("MARKER");
  });

  it("raises an alert for an invalid result, and fails the call", async () => {
    const { host, published, started } = await setup();
    const driver = await started();
    driver.handle("listFiles", () => ({ files: "none" }));

    await expect(
      host.call({ op: "listFiles", args: {} }, CALL_TIMEOUT_MS),
    ).rejects.toMatchObject({ code: "internal" });

    expect(published().map((event) => event.payload)).toEqual([
      expect.objectContaining({ code: "driver_protocol_error" }),
    ]);
  });

  it("raises at most one alert a minute, then counts the rest", async () => {
    let now = 1_000_000;
    const { logs, published, started } = await setup({ now: () => now });
    const driver = await started();
    const malformed = async () => {
      driver.emitUnchecked({ type: "nonsense" });
      await settle();
    };

    await malformed();
    now += 1;
    await malformed();
    now += PROTOCOL_ALERT_INTERVAL_MS - 2;
    await malformed();
    expect(published()).toHaveLength(1);

    now += 1;
    await malformed();
    await malformed();
    now += PROTOCOL_ALERT_INTERVAL_MS;
    await malformed();

    expect(published().map((event) => event.payload)).toEqual(
      [
        ALERT_MESSAGE,
        "The driver sent a message the server couldn't read, and 2 more since the last alert. The server log has the details.",
        "The driver sent a message the server couldn't read, and 1 more since the last alert. The server log has the details.",
      ].map((message) => ({
        severity: "error",
        code: "driver_protocol_error",
        message,
      })),
    );
    expect(logs().filter((entry) => entry.problem !== undefined)).toHaveLength(
      6,
    );
  });

  it("limits each printer separately", async () => {
    const first = await setup({ now: () => 0 });
    const second = await setup({ now: () => 0 });
    const drivers = [await first.started(), await second.started()];

    for (const driver of [...drivers, ...drivers]) {
      driver.emitUnchecked({ type: "nonsense" });
    }
    await settle();

    expect(first.published()).toHaveLength(1);
    expect(second.published()).toHaveLength(1);
  });
});

describe("DriverHost.stop", () => {
  it("disconnects, disposes and closes the driver", async () => {
    const { host, published, started } = await setup();
    const driver = await started();

    await host.stop();

    expect(driver.ops()).toEqual(["connect", "disconnect", "dispose"]);
    expect(driver.disposed).toBe(true);
    expect(host.running).toBe(false);
    expect(published()).toEqual([
      {
        type: "printer.status_changed",
        source: driverSource,
        payload: {
          previous: "idle",
          status: "offline",
          detail: null,
          error: null,
        },
      },
    ]);
  });

  it("publishes nothing the driver sends afterwards, and logs it", async () => {
    const { host, logs, published, started } = await setup();
    const driver = await started();
    await host.stop();
    const before = published().length;

    driver.emit({ type: "files_changed" });
    await settle();

    expect(published()).toHaveLength(before);
    expect(logs().at(-1)).toMatchObject({
      level: "warn",
      component: "driver-host",
      messageType: "files_changed",
      msg: "The driver emitted a message after it was disposed; dropped it",
    });
  });

  it("fails calls as offline once stopping has begun", async () => {
    const { drivers, host, started } = await setup();
    let finish = () => {};
    drivers.handle(
      "disconnect",
      () => new Promise<void>((resolve) => (finish = resolve)),
    );
    const driver = await started();

    const stopping = host.stop();
    await expect(
      host.call({ op: "pause", args: {} }, CALL_TIMEOUT_MS),
    ).rejects.toEqual(
      new DriverError("offline", "The printer's driver isn't running."),
    );
    finish();
    await stopping;

    expect(driver.ops()).not.toContain("pause");
  });

  it("fails a call still running when the driver is closed", async () => {
    const { host, started } = await setup();
    const driver = await started();
    driver.handle("sendFile", () => new Promise(() => {}));

    const upload = host.call(
      {
        op: "sendFile",
        args: { fileName: "a.gcode", sizeBytes: 1, path: "/staging/a" },
      },
      CALL_TIMEOUT_MS,
    );
    await settle();
    await host.stop();

    await expect(upload).rejects.toMatchObject({
      code: "internal",
      message: "The driver connection closed.",
    });
  });

  it("disposes even if disconnect fails or takes over 10 s", async () => {
    vi.useFakeTimers({ toNotFake: ["setImmediate", "clearImmediate"] });
    const { drivers, host, logs, started } = await setup();
    drivers.handle("disconnect", () => new Promise(() => {}));
    drivers.handle("dispose", () => {
      throw new Error("The socket was already gone.");
    });
    const driver = await started();

    const stopping = host.stop();
    await vi.advanceTimersByTimeAsync(CALL_TIMEOUT_MS);
    await stopping;

    expect(driver.ops()).toEqual(["connect", "disconnect", "dispose"]);
    expect(
      logs()
        .filter(
          (line) =>
            line.msg === "A driver call failed while stopping; carried on",
        )
        .map((line) => line.op),
    ).toEqual(["disconnect", "dispose"]);
    expect(host.running).toBe(false);
  });

  it("does nothing when no driver is running", async () => {
    const { host, published } = await setup();

    await host.stop();

    expect(published()).toEqual([]);
  });
});

describe("DriverHost.call", () => {
  it("calls the driver and resolves with its parsed result", async () => {
    const { host, started } = await setup();
    const driver = await started();

    await host.call(
      { op: "setFan", args: { fanId: "part", percent: 40 } },
      CALL_TIMEOUT_MS,
    );

    expect(driver.calls.at(-1)).toEqual({
      op: "setFan",
      args: { fanId: "part", percent: 40 },
    });
    await expect(
      host.call({ op: "listCameras", args: {} }, CALL_TIMEOUT_MS),
    ).resolves.toEqual({ cameras: [] });
  });

  it("fails as timeout after the given time", async () => {
    vi.useFakeTimers({ toNotFake: ["setImmediate", "clearImmediate"] });
    const { host, started } = await setup();
    const driver = await started();
    driver.handle("home", () => new Promise(() => {}));

    const homing = host.call({ op: "home", args: { axes: [] } }, 1234);
    const failed = expect(homing).rejects.toEqual(
      new DriverError(
        "timeout",
        'The driver didn\'t answer "home" within 1234 ms.',
      ),
    );
    await vi.advanceTimersByTimeAsync(1234);
    await failed;
  });

  it("fails as offline before the driver has started", async () => {
    const { host } = await setup();

    await expect(
      host.call({ op: "pause", args: {} }, CALL_TIMEOUT_MS),
    ).rejects.toMatchObject({ code: "offline" });
  });
});

describe("DriverHost: the transport", () => {
  const withDate = {
    type: "status",
    status: "idle",
    detail: new Date(0),
    error: null,
  };

  it("checks every message in development and test, like a worker boundary", async () => {
    const { host, published, started } = await setup();
    const driver = await started();
    driver.handle("pause", (_, self) => self.emitUnchecked(withDate));

    await expect(
      host.call({ op: "pause", args: {} }, CALL_TIMEOUT_MS),
    ).rejects.toMatchObject({ code: "internal" });
    expect(published()).toEqual([]);
  });

  it("passes messages by reference when cloning is off, as in production", async () => {
    const { host, published, started } = await setup({ clone: false });
    const driver = await started();
    driver.handle("pause", (_, self) => self.emitUnchecked(withDate));

    await host.call({ op: "pause", args: {} }, CALL_TIMEOUT_MS);
    await settle();

    // Nothing stopped the Date at the driver; the host's parse still did.
    expect(published().map((event) => event.type)).toEqual(["printer.alert"]);
  });
});
