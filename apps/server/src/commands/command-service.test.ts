// SPDX-FileCopyrightText: 2026 Open Print Stack contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  DriverError,
  DriverErrorCode,
  type DriverMessage,
} from "@openprintstack/driver-sdk";
import {
  type Capabilities,
  COMMAND_POLICY,
  initialPrinterState,
  CommandKind,
  ONLINE_STATUSES,
  type OpsEvent,
  type PrinterCommand,
  type PrinterCommandOf,
  type PrinterStatus,
  PrinterStatus as PrinterStatusSchema,
} from "@openprintstack/protocol";
import { asc, eq } from "drizzle-orm";
import { afterEach, describe, expect, it, onTestFinished, vi } from "vitest";
import { z } from "zod";

import { EventBus } from "../bus/bus.ts";
import { createRepos } from "../db/repos/index.ts";
import { events as eventsTable } from "../db/schema.ts";
import { CALL_TIMEOUT_MS, UPLOAD_TIMEOUT_MS } from "../drivers/host.ts";
import {
  TEST_DRIVER_TYPE,
  testCapabilities,
  type TestDriver,
  TestDrivers,
  testRegistry,
  testSettingsSchema,
} from "../drivers/test-driver.ts";
import { EventPersistence } from "../events/persistence.ts";
import { dataPaths, ensureDataDirs, stagedFilePath } from "../paths.ts";
import {
  PrinterService,
  PrinterServiceError,
} from "../printers/printer-service.ts";
import { StateStore } from "../state/store.ts";
import {
  debugLogger,
  jsonLines,
  settle,
  tempDir,
  testDatabase,
} from "../test-utils.ts";
import {
  checkCommand,
  type CommandResult,
  CommandService,
} from "./command-service.ts";
import type { CommandErrorCode } from "./errors.ts";

const USER_ID = "0199b3a0-1c00-7000-8000-00000000a001";
const STAGED_ID = "0199b3a0-1c00-7000-8000-0000000000f1";

/** One safe command of each kind, for a homed test printer at 10/10/10. */
const COMMANDS: { [K in CommandKind]: PrinterCommandOf<K> } = {
  "print.start": { kind: "print.start", fileName: "a.gcode" },
  "print.pause": { kind: "print.pause" },
  "print.resume": { kind: "print.resume" },
  "print.cancel": { kind: "print.cancel" },
  "motion.home": { kind: "motion.home", axes: [] },
  "motion.move": { kind: "motion.move", x: 5, speedMmS: 100 },
  "temperature.set": {
    kind: "temperature.set",
    heaterId: "nozzle",
    targetC: 200,
  },
  "fan.set": { kind: "fan.set", fanId: "part", percent: 50 },
  "file.upload": {
    kind: "file.upload",
    stagedFileId: STAGED_ID,
    fileName: "a.gcode",
    sizeBytes: 100,
  },
  "extension.invoke": {
    kind: "extension.invoke",
    extension: "test",
    action: "poke",
    params: null,
  },
};

const HOMED: DriverMessage = {
  type: "telemetry",
  telemetry: {
    position: { x: 10, y: 10, z: 10 },
    homedAxes: ["x", "y", "z"],
  },
};

afterEach(() => {
  vi.useRealTimers();
});

function status(to: PrinterStatus): DriverMessage {
  return { type: "status", status: to, detail: null, error: null };
}

async function setup(options: { now?: () => number; persist?: boolean } = {}) {
  const { logger, output } = await debugLogger();
  const db = await testDatabase();
  const repos = createRepos(db);
  const store = new StateStore({
    lookupPrinter: (id) => repos.printers.findById(id),
    logger,
  });
  const bus = new EventBus({ store, logger });
  const events: OpsEvent[] = [];
  bus.subscribe("test", (event) => events.push(event));
  const persistence = options.persist
    ? new EventPersistence({
        bus,
        events: repos.events,
        logger,
        sampleIntervalMs: 0,
      })
    : undefined;
  const paths = dataPaths(await tempDir());
  await ensureDataDirs(paths);
  const drivers = new TestDrivers();
  const printers = new PrinterService({
    printers: repos.printers,
    registry: testRegistry(drivers),
    bus,
    store,
    paths,
    logger,
  });
  const commands = new CommandService({
    printers,
    store,
    bus,
    paths,
    logger,
    ...(options.now && { now: options.now }),
  });
  onTestFinished(async () => {
    await printers.stopAll();
    persistence?.close();
  });

  /**
   * Adds a test printer, puts it in `current` (homed at 10/10/10 while
   * online), and clears the events so far.
   */
  const printer = async (
    current: PrinterStatus = "idle",
    name = "Bench",
  ): Promise<{ id: string; driver: TestDriver }> => {
    const { id } = await printers.add({
      name,
      driverType: TEST_DRIVER_TYPE,
      settings: {},
      userId: USER_ID,
    });
    const driver = drivers.latest(id);
    driver.emit(status(current));
    driver.emit(HOMED);
    await settle();
    events.length = 0;
    return { id, driver };
  };

  const run = (printerId: string, command: PrinterCommand) =>
    commands.execute({ printerId, command, userId: USER_ID });

  return {
    bus,
    commands,
    db,
    drivers,
    events,
    logs: () => jsonLines(output),
    paths,
    persistence,
    printer,
    printers,
    run,
    store,
  };
}

/** The result's error code, or "ok". */
function outcome(result: CommandResult): CommandErrorCode | "ok" {
  return result.ok ? "ok" : (result.error?.code as CommandErrorCode);
}

/** The driver calls made after connecting. */
function commandCalls(driver: TestDriver) {
  return driver.ops().filter((op) => op !== "connect");
}

describe("CommandService: events", () => {
  it("publishes command.requested, calls the driver, then publishes command.result", async () => {
    const { bus, events, printer, run } = await setup();
    const { id, driver } = await printer("printing");
    const seenByDriver: string[] = [];
    driver.handle("pause", () => {
      seenByDriver.push(...events.map((event) => event.type));
    });

    const result = await run(id, COMMANDS["print.pause"]);

    expect(result).toEqual({
      commandId: result.commandId,
      ok: true,
      durationMs: expect.any(Number) as number,
    });
    expect(z.uuidv7().safeParse(result.commandId).success).toBe(true);
    expect(seenByDriver).toEqual(["command.requested"]);
    expect(events).toMatchObject([
      {
        type: "command.requested",
        printerId: id,
        source: { kind: "user", userId: USER_ID },
        correlationId: result.commandId,
        payload: {
          commandId: result.commandId,
          command: { kind: "print.pause" },
        },
      },
      {
        type: "command.result",
        printerId: id,
        source: { kind: "user", userId: USER_ID },
        correlationId: result.commandId,
        payload: result,
      },
    ]);
    void bus;
  });

  it("publishes a result for every refusal too", async () => {
    const { events, printer, run } = await setup();
    const { id, driver } = await printer("idle");

    const result = await run(id, COMMANDS["print.pause"]);

    expect(result).toMatchObject({
      ok: false,
      error: {
        code: "invalid_state",
        message: "print.pause isn't allowed while the printer is idle.",
      },
    });
    expect(events.map((event) => event.type)).toEqual([
      "command.requested",
      "command.result",
    ]);
    expect(events[1]?.payload).toEqual(result);
    expect(commandCalls(driver)).toEqual([]);
  });

  it("gives every command its own id", async () => {
    const { printer, run } = await setup();
    const { id } = await printer("idle");

    const first = await run(id, COMMANDS["fan.set"]);
    const second = await run(id, COMMANDS["fan.set"]);

    expect(first.commandId).not.toBe(second.commandId);
  });

  it("measures the duration from the request to the result, in whole ms", async () => {
    let clock = 100;
    const { printer, run } = await setup({ now: () => clock });
    const { id, driver } = await printer("idle");
    driver.handle("setFan", () => {
      clock = 342.6;
    });

    expect((await run(id, COMMANDS["fan.set"])).durationMs).toBe(243);
  });

  it("throws for an unknown printer, publishing nothing", async () => {
    const { events, run } = await setup();

    const error: unknown = await run(
      "0199b3a0-1c00-7000-8000-000000000999",
      COMMANDS["print.pause"],
    ).catch((reason: unknown) => reason);

    expect(error).toBeInstanceOf(PrinterServiceError);
    expect(error).toMatchObject({ code: "printer_not_found" });
    expect(events).toEqual([]);
  });
});

describe("CommandService: an offline printer", () => {
  const needsOnline = CommandKind.options.filter(
    (kind) => COMMAND_POLICY[kind].requiresOnline,
  );

  it.each(
    needsOnline.flatMap((kind) =>
      (["offline", "connecting"] as const).map(
        (current) => [kind, current] as const,
      ),
    ),
  )("refuses %s at once while %s", async (kind, current) => {
    vi.useFakeTimers({ toNotFake: ["setImmediate", "clearImmediate"] });
    const { printer, run } = await setup();
    const { id, driver } = await printer(current);

    const result = await run(id, COMMANDS[kind]);

    expect(result).toMatchObject({
      ok: false,
      error: {
        code: "printer_offline",
        message:
          current === "connecting"
            ? "The printer is still connecting."
            : "The printer is offline.",
      },
      durationMs: 0,
    });
    expect(commandCalls(driver)).toEqual([]);
  });

  it("records both command events, with the user, in the database", async () => {
    const { db, persistence, printer, run } = await setup({ persist: true });
    const { id } = await printer("offline");

    const result = await run(id, COMMANDS["temperature.set"]);
    persistence?.close();

    const rows = db
      .select()
      .from(eventsTable)
      .where(eq(eventsTable.correlationId, result.commandId))
      .orderBy(asc(eventsTable.rowId))
      .all();
    expect(rows).toMatchObject([
      {
        type: "command.requested",
        printerId: id,
        source: "user",
        userId: USER_ID,
        payload: {
          commandId: result.commandId,
          command: COMMANDS["temperature.set"],
        },
      },
      {
        type: "command.result",
        printerId: id,
        source: "user",
        userId: USER_ID,
        payload: {
          ok: false,
          error: {
            code: "printer_offline",
            message: "The printer is offline.",
          },
        },
      },
    ]);
  });

  it("still sends extension.invoke, which the driver decides", async () => {
    const { printer, run } = await setup();
    const { id, driver } = await printer("offline");

    expect(outcome(await run(id, COMMANDS["extension.invoke"]))).toBe("ok");
    expect(commandCalls(driver)).toEqual(["invokeExtension"]);
  });

  it("refuses every command for a printer whose driver never started", async () => {
    const { printers, run } = await setup();
    const { id } = await printers.add({
      name: "Broken",
      driverType: TEST_DRIVER_TYPE,
      settings: { failCreate: true },
      userId: USER_ID,
    });

    for (const kind of CommandKind.options) {
      expect(outcome(await run(id, COMMANDS[kind]))).toBe("printer_offline");
    }
  });
});

describe("CommandService: COMMAND_POLICY", () => {
  const cases = CommandKind.options.flatMap((kind) =>
    ONLINE_STATUSES.map(
      (current) =>
        [
          kind,
          current,
          COMMAND_POLICY[kind].allowedStatuses.includes(current)
            ? "ok"
            : "invalid_state",
        ] as const,
    ),
  );

  it.each(cases)("%s while %s: %s", async (kind, current, expected) => {
    const { printer, run } = await setup();
    const { id, driver } = await printer(current);

    const result = await run(id, COMMANDS[kind]);

    expect(outcome(result)).toBe(expected);
    expect(commandCalls(driver)).toHaveLength(expected === "ok" ? 1 : 0);
  });

  it("covers every status", () => {
    expect(new Set(cases.map(([, current]) => current))).toEqual(
      new Set(
        PrinterStatusSchema.options.filter(
          (current) => current !== "offline" && current !== "connecting",
        ),
      ),
    );
  });
});

describe("CommandService: capabilities", () => {
  const base = testCapabilities(testSettingsSchema.parse({}));

  it.each<[string, Partial<Capabilities>, PrinterCommand, string]>([
    [
      "a command kind the printer doesn't have",
      { commands: base.commands.filter((kind) => kind !== "fan.set") },
      COMMANDS["fan.set"],
      "The printer doesn't support fan.set.",
    ],
    [
      "an unknown heater",
      {},
      { kind: "temperature.set", heaterId: "chamber", targetC: 40 },
      'The printer has no heater "chamber".',
    ],
    [
      "an unknown fan",
      {},
      { kind: "fan.set", fanId: "aux", percent: 10 },
      'The printer has no fan "aux".',
    ],
    [
      "a fan that only reports its speed",
      {},
      { kind: "fan.set", fanId: "hotend", percent: 10 },
      "The Hotend fan only reports its speed.",
    ],
    [
      "an extension the printer doesn't have",
      {},
      { ...COMMANDS["extension.invoke"], extension: "simulator" },
      'The printer has no "simulator" extension.',
    ],
    [
      "an upload to a printer that takes none",
      { files: { ...base.files, upload: false } },
      COMMANDS["file.upload"],
      "The printer doesn't take uploads.",
    ],
    [
      "a file type the printer doesn't take",
      {
        files: { ...base.files, acceptedExtensions: [".gcode", ".bgcode"] },
      },
      { ...COMMANDS["file.upload"], fileName: "benchy.3mf" },
      "The printer only takes .gcode or .bgcode files.",
    ],
  ])("refuses %s as unsupported", async (_, changes, command, message) => {
    const { printer, run } = await setup();
    const { id, driver } = await printer("idle");
    driver.emit({
      type: "capabilities",
      capabilities: { ...base, ...changes },
    });
    await settle();

    expect(await run(id, command)).toMatchObject({
      ok: false,
      error: { code: "unsupported", message },
    });
    expect(commandCalls(driver)).toEqual([]);
  });

  it.each([
    ["any case", [".gcode"], "BENCHY.GCODE"],
    ["any file when the list is empty", [], "benchy.stl"],
  ])("accepts %s", async (_, acceptedExtensions, fileName) => {
    const { printer, run } = await setup();
    const { id, driver } = await printer("idle");
    driver.emit({
      type: "capabilities",
      capabilities: { ...base, files: { ...base.files, acceptedExtensions } },
    });
    await settle();

    expect(
      outcome(await run(id, { ...COMMANDS["file.upload"], fileName })),
    ).toBe("ok");
  });
});

describe("CommandService: the order of the checks", () => {
  it("checks capabilities before the online state", async () => {
    const { printer, run } = await setup();
    const { id, driver } = await printer("offline");
    driver.emit({
      type: "capabilities",
      capabilities: {
        ...testCapabilities(testSettingsSchema.parse({})),
        commands: [],
      },
    });
    await settle();

    expect(outcome(await run(id, COMMANDS["print.pause"]))).toBe("unsupported");
  });

  it("checks the status before safety", async () => {
    const { printer, run } = await setup();
    const { id } = await printer("cancelling");

    expect(
      outcome(
        await run(id, {
          kind: "temperature.set",
          heaterId: "nozzle",
          targetC: 999,
        }),
      ),
    ).toBe("invalid_state");
  });

  it("checks safety before calling the driver", async () => {
    const { printer, run } = await setup();
    const { id, driver } = await printer("idle");

    const result = await run(id, {
      kind: "temperature.set",
      heaterId: "nozzle",
      targetC: 251,
    });

    expect(result).toMatchObject({
      ok: false,
      error: {
        code: "unsafe",
        message: "251 °C is above the Nozzle's 250 °C maximum.",
      },
    });
    expect(commandCalls(driver)).toEqual([]);
  });

  it("checks the lock before anything else", async () => {
    const { printer, run } = await setup();
    const { id, driver } = await printer("idle");
    driver.handle("setFan", () => new Promise(() => {}));
    void run(id, COMMANDS["fan.set"]);
    await settle();

    expect(
      outcome(await run(id, { ...COMMANDS["fan.set"], fanId: "nope" })),
    ).toBe("printer_busy");
  });
});

describe("CommandService: one command at a time", () => {
  /** Makes `op` wait until the returned function is called. */
  function hold(driver: TestDriver, op: Parameters<TestDriver["handle"]>[0]) {
    let release = () => {};
    driver.handle(
      op,
      () => new Promise<void>((resolve) => (release = resolve)),
    );
    return () => release();
  }

  it("refuses a second command at once, without waiting, then accepts the next", async () => {
    const { printer, run } = await setup();
    const { id, driver } = await printer("printing");
    const release = hold(driver, "pause");

    const first = run(id, COMMANDS["print.pause"]);
    await settle();
    const second = await run(id, COMMANDS["temperature.set"]);
    const third = await run(id, COMMANDS["print.cancel"]);

    expect(second).toMatchObject({
      ok: false,
      error: {
        code: "printer_busy",
        message: "Another command to this printer is still running.",
      },
    });
    expect(outcome(third)).toBe("printer_busy");
    expect(commandCalls(driver)).toEqual(["pause"]);

    release();
    expect(outcome(await first)).toBe("ok");
    expect(outcome(await run(id, COMMANDS["print.cancel"]))).toBe("ok");
  });

  it("locks each printer separately", async () => {
    const { printer, run } = await setup();
    const bench = await printer("idle", "Bench");
    const workshop = await printer("idle", "Workshop");
    hold(bench.driver, "setFan");

    void run(bench.id, COMMANDS["fan.set"]);
    await settle();

    expect(outcome(await run(workshop.id, COMMANDS["fan.set"]))).toBe("ok");
  });

  it("runs uploads in their own lane, one at a time", async () => {
    const { printer, run } = await setup();
    const { id, driver } = await printer("printing");
    const release = hold(driver, "sendFile");

    const upload = run(id, COMMANDS["file.upload"]);
    await settle();

    expect(outcome(await run(id, COMMANDS["print.pause"]))).toBe("ok");
    expect(await run(id, COMMANDS["file.upload"])).toMatchObject({
      ok: false,
      error: {
        code: "printer_busy",
        message: "Another upload to this printer is still running.",
      },
    });
    release();
    expect(outcome(await upload)).toBe("ok");
  });

  it("frees the printer after a refusal or a failure", async () => {
    const { printer, run } = await setup();
    const { id, driver } = await printer("idle");
    driver.handle("setFan", () => {
      throw new DriverError("printer_rejected", "No.");
    });

    expect(
      outcome(await run(id, { ...COMMANDS["temperature.set"], targetC: 999 })),
    ).toBe("unsafe");
    expect(outcome(await run(id, COMMANDS["fan.set"]))).toBe(
      "printer_rejected",
    );
    expect(outcome(await run(id, COMMANDS["motion.home"]))).toBe("ok");
  });
});

describe("CommandService: timeouts", () => {
  it("fails a command after 10 s and frees the printer", async () => {
    vi.useFakeTimers({ toNotFake: ["setImmediate", "clearImmediate"] });
    const { printer, run } = await setup();
    const { id, driver } = await printer("idle");
    driver.handle("home", () => new Promise(() => {}));

    const homing = run(id, COMMANDS["motion.home"]);
    await vi.advanceTimersByTimeAsync(CALL_TIMEOUT_MS - 1);
    expect(outcome(await run(id, COMMANDS["fan.set"]))).toBe("printer_busy");
    await vi.advanceTimersByTimeAsync(1);

    expect(await homing).toMatchObject({
      ok: false,
      error: {
        code: "timeout",
        message: `The driver didn't answer "home" within ${CALL_TIMEOUT_MS} ms.`,
      },
      durationMs: CALL_TIMEOUT_MS,
    });
    expect(outcome(await run(id, COMMANDS["fan.set"]))).toBe("ok");
  });

  it("gives an upload 10 minutes", async () => {
    vi.useFakeTimers({ toNotFake: ["setImmediate", "clearImmediate"] });
    const { printer, run } = await setup();
    const { id, driver } = await printer("idle");
    driver.handle("sendFile", () => new Promise(() => {}));
    let result: CommandResult | undefined;

    void run(id, COMMANDS["file.upload"]).then((done) => (result = done));
    await vi.advanceTimersByTimeAsync(UPLOAD_TIMEOUT_MS - 1);
    expect(result).toBeUndefined();
    await vi.advanceTimersByTimeAsync(1);

    expect(result).toMatchObject({ ok: false, error: { code: "timeout" } });
  });
});

describe("CommandService: driver errors", () => {
  const renamed: Partial<Record<DriverErrorCode, CommandErrorCode>> = {
    not_supported: "unsupported",
    offline: "printer_offline",
  };

  it.each(DriverErrorCode.options)(
    "reports %s in the server's vocabulary, with the driver's message",
    async (code) => {
      const { printer, run } = await setup();
      const { id, driver } = await printer("idle");
      driver.handle("home", () => {
        throw new DriverError(code, `The driver says ${code}.`);
      });

      expect(await run(id, COMMANDS["motion.home"])).toMatchObject({
        ok: false,
        error: {
          code: renamed[code] ?? code,
          message: `The driver says ${code}.`,
        },
      });
    },
  );

  it("reports anything else as internal, and logs it", async () => {
    const { logs, printer, run } = await setup();
    const { id, driver } = await printer("idle");
    driver.handle("home", () => {
      throw new TypeError("x is undefined");
    });

    expect(await run(id, COMMANDS["motion.home"])).toMatchObject({
      ok: false,
      error: { code: "internal", message: "x is undefined" },
    });
    expect(logs().at(-1)).toMatchObject({
      level: "error",
      component: "commands",
      kind: "motion.home",
      msg: "A command failed unexpectedly",
    });
  });
});

describe("CommandService: driver calls", () => {
  it("sends an upload's staged file path, name and size", async () => {
    const { paths, printer, run } = await setup();
    const { id, driver } = await printer("idle");

    await run(id, COMMANDS["file.upload"]);

    expect(driver.calls.at(-1)).toEqual({
      op: "sendFile",
      args: {
        fileName: "a.gcode",
        sizeBytes: 100,
        path: stagedFilePath(paths, STAGED_ID),
      },
    });
  });

  it("refuses a staged file id that isn't a UUID", async () => {
    const { printer, run } = await setup();
    const { id, driver } = await printer("idle");

    expect(
      await run(id, {
        ...COMMANDS["file.upload"],
        stagedFileId: "../ops.sqlite",
      }),
    ).toMatchObject({
      ok: false,
      error: {
        code: "internal",
        message: 'Not a staged file id: "../ops.sqlite"',
      },
    });
    expect(commandCalls(driver)).toEqual([]);
  });

  it.each(CommandKind.options)("sends %s to the driver", async (kind) => {
    const { printer, run } = await setup();
    const allowed = COMMAND_POLICY[kind].allowedStatuses[0] ?? "idle";
    const { id, driver } = await printer(allowed);

    expect(outcome(await run(id, COMMANDS[kind]))).toBe("ok");
    expect(commandCalls(driver)).toHaveLength(1);
  });
});

describe("CommandService with the simulated printer", () => {
  async function simulated() {
    vi.useFakeTimers({ toNotFake: ["setImmediate", "clearImmediate"] });
    const context = await setup();
    const { id } = await context.printers.add({
      name: "Sim",
      driverType: "simulated",
      settings: { speedMultiplier: 1000 },
      userId: USER_ID,
    });
    const statusOf = () => context.store.get(id)?.state.status;
    const run = (command: PrinterCommand) => context.run(id, command);
    return { ...context, id, run, statusOf };
  }

  it("refuses 400 °C and a jog before homing; homes, then jogs", async () => {
    const { id, run, statusOf, store } = await simulated();

    expect(
      await run({ kind: "temperature.set", heaterId: "nozzle", targetC: 400 }),
    ).toMatchObject({
      ok: false,
      error: {
        code: "unsafe",
        message: "400 °C is above the Nozzle's 300 °C maximum.",
      },
    });
    expect(await run({ kind: "motion.move", x: 10 })).toMatchObject({
      ok: false,
      error: { code: "unsafe", message: "Home x before jogging." },
    });

    expect(outcome(await run({ kind: "motion.home", axes: [] }))).toBe("ok");
    expect(statusOf()).toBe("busy");
    expect(outcome(await run({ kind: "motion.move", x: 10 }))).toBe(
      "invalid_state",
    );
    await vi.advanceTimersByTimeAsync(1000);
    expect(statusOf()).toBe("idle");

    expect(outcome(await run({ kind: "motion.move", x: 10, y: 5 }))).toBe("ok");
    expect(store.get(id)?.state.telemetry.position).toEqual({
      x: 10,
      y: 5,
      z: 0,
    });
    expect(await run({ kind: "motion.move", x: -11 })).toMatchObject({
      ok: false,
      error: {
        code: "unsafe",
        message: "That jog would take x to -1 mm, outside 0–256 mm.",
      },
    });
  });

  it("fails commands at once during a simulated disconnect; clear brings it back", async () => {
    const { run, statusOf } = await simulated();
    const fault = (action: string, params: unknown) =>
      run({
        kind: "extension.invoke",
        extension: "simulator",
        action,
        params: params as null,
      });

    expect(outcome(await fault("fault.disconnect", { durationS: 15 }))).toBe(
      "ok",
    );
    expect(statusOf()).toBe("offline");
    expect(await run({ kind: "motion.home", axes: [] })).toMatchObject({
      ok: false,
      error: { code: "printer_offline" },
      durationMs: 0,
    });

    expect(outcome(await fault("clear", null))).toBe("ok");
    expect(statusOf()).toBe("idle");
  });
});

describe("checkCommand", () => {
  it("refuses a printer the state store doesn't know as offline", () => {
    expect(checkCommand(undefined, COMMANDS["print.pause"])).toEqual({
      code: "printer_offline",
      message: "The printer hasn't reported its state yet.",
    });
  });

  it("skips the capabilities check when there are none, so the online check refuses", () => {
    const state = {
      ...initialPrinterState("2026-10-05T12:00:00.000Z"),
      status: "offline" as const,
    };

    expect(checkCommand(state, COMMANDS["fan.set"])).toMatchObject({
      code: "printer_offline",
    });
    expect(checkCommand(state, COMMANDS["extension.invoke"])).toBeNull();
  });
});
