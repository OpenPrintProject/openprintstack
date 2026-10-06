// SPDX-FileCopyrightText: 2026 Open Print Stack contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { access, readdir, writeFile } from "node:fs/promises";
import path from "node:path";

import type { DriverMessage } from "@openprintstack/driver-sdk";
import {
  type OpsEvent,
  PrinterStatus as PrinterStatusSchema,
  type PrinterStatus,
} from "@openprintstack/protocol";
import { describe, expect, it, onTestFinished, vi } from "vitest";

import { EventBus } from "../bus/bus.ts";
import { createRepos } from "../db/repos/index.ts";
import type { PrinterSettings } from "../db/schema.ts";
import { CALL_TIMEOUT_MS, START_FAILED_DETAIL } from "../drivers/host.ts";
import {
  TEST_DRIVER_TYPE,
  testCapabilities,
  TestDrivers,
  testRegistry,
  testSettingsSchema,
} from "../drivers/test-driver.ts";
import { dataPaths, ensureDataDirs, printerDir } from "../paths.ts";
import { StateStore } from "../state/store.ts";
import { debugLogger, settle, tempDir, testDatabase } from "../test-utils.ts";
import {
  JOB_STATUSES,
  PrinterService,
  PrinterServiceError,
} from "./printer-service.ts";

const USER_ID = "0199b3a0-1c00-7000-8000-00000000a001";
const NOW = 1_000_000;
const DEFAULTS = testSettingsSchema.parse({});

/** The plan's "job is active" statuses, written out rather than imported. */
const ACTIVE_JOB: readonly PrinterStatus[] = [
  "preparing",
  "printing",
  "pausing",
  "paused",
  "cancelling",
];

function status(to: PrinterStatus): DriverMessage {
  return { type: "status", status: to, detail: null, error: null };
}

async function setup(options: { clone?: boolean } = {}) {
  const { logger } = await debugLogger();
  const repos = createRepos(await testDatabase());
  const store = new StateStore({
    lookupPrinter: (id) => repos.printers.findById(id),
    logger,
  });
  const bus = new EventBus({ store, logger });
  const events: OpsEvent[] = [];
  bus.subscribe("test", (event) => events.push(event));
  const paths = dataPaths(await tempDir());
  await ensureDataDirs(paths);
  const drivers = new TestDrivers();
  const service = new PrinterService({
    printers: repos.printers,
    registry: testRegistry(drivers),
    bus,
    store,
    paths,
    logger,
    now: () => NOW,
    ...options,
  });
  onTestFinished(async () => {
    await service.stopAll();
  });

  /** Stores a printer without starting it, as if from an earlier run. */
  const stored = (
    name: string,
    settings: PrinterSettings = {},
    driverType = TEST_DRIVER_TYPE,
  ) => repos.printers.create({ name, driverType, settings, now: 1 });

  /** Adds a test printer and returns it, with the events so far cleared. */
  const added = async (name = "Bench", settings: unknown = {}) => {
    const printer = await service.add({
      name,
      driverType: TEST_DRIVER_TYPE,
      settings,
      userId: USER_ID,
    });
    events.length = 0;
    return { printer, driver: drivers.latest(printer.id) };
  };

  /** Each event as type and payload, optionally for one printer. */
  const published = (printerId?: string) =>
    events
      .filter(
        (event) => printerId === undefined || event.printerId === printerId,
      )
      .map(({ type, payload }) => ({ type, payload }));

  const types = () => events.map((event) => event.type);

  const statusOf = (printerId: string) => store.get(printerId)?.state.status;

  return {
    added,
    bus,
    drivers,
    events,
    paths,
    published,
    repos,
    service,
    statusOf,
    store,
    stored,
    types,
  };
}

/** Expects `promise` to reject with a PrinterServiceError with this code. */
async function expectRefused(
  promise: Promise<unknown>,
  code: PrinterServiceError["code"],
  message?: string,
) {
  const error: unknown = await promise.then(
    () => undefined,
    (reason: unknown) => reason,
  );
  expect(error).toBeInstanceOf(PrinterServiceError);
  expect(error).toMatchObject(
    message === undefined ? { code } : { code, message },
  );
}

function connecting(previous: PrinterStatus | null = null) {
  return {
    type: "printer.status_changed",
    payload: { previous, status: "connecting", detail: null, error: null },
  };
}

function idle() {
  return {
    type: "printer.status_changed",
    payload: {
      previous: "connecting",
      status: "idle",
      detail: null,
      error: null,
    },
  };
}

function capabilitiesFor(settings: unknown) {
  return {
    type: "printer.capabilities_changed",
    payload: {
      capabilities: testCapabilities(testSettingsSchema.parse(settings)),
    },
  };
}

describe("PrinterService.startAll", () => {
  it("starts every stored printer, publishing connecting before its driver starts", async () => {
    const { bus, drivers, published, service, statusOf, stored } =
      await setup();
    const prusa = stored("Prusa");
    const voron = stored("Voron", { nozzleMaxC: 300 });
    const createdAt = new Map<string, number>();
    bus.subscribe("probe", (event) => {
      if (
        event.type === "printer.status_changed" &&
        event.payload.status === "connecting"
      ) {
        createdAt.set(event.printerId, drivers.created.length);
      }
    });

    await service.startAll();

    expect(published(prusa.id)).toEqual([
      connecting(),
      capabilitiesFor({}),
      idle(),
    ]);
    expect(published(voron.id)).toEqual([
      connecting(),
      capabilitiesFor({ nozzleMaxC: 300 }),
      idle(),
    ]);
    // Both connecting before either driver: they start in parallel.
    expect([...createdAt.values()]).toEqual([0, 0]);
    expect(statusOf(prusa.id)).toBe("idle");
    expect(statusOf(voron.id)).toBe("idle");
    expect(service.has(prusa.id)).toBe(true);
  });

  it("waits for every printer's first connect attempt", async () => {
    const { drivers, service, stored } = await setup();
    stored("Prusa");
    stored("Voron");
    const finishers: (() => void)[] = [];
    drivers.handle("connect", (_, driver) => {
      return new Promise<void>((resolve) =>
        finishers.push(() => {
          driver.emit(status("idle"));
          resolve();
        }),
      );
    });
    let done = false;

    const starting = service.startAll().then(() => (done = true));
    // Both drivers connect at once: they start in parallel.
    await vi.waitFor(() => expect(finishers).toHaveLength(2));
    finishers[0]?.();
    await settle();
    expect(done).toBe(false);
    finishers[1]?.();
    await starting;

    expect(done).toBe(true);
  });

  it("gives each driver its printer's folder, with the stored settings parsed", async () => {
    const { drivers, paths, service, stored } = await setup();
    const printer = stored("Prusa", { nozzleMaxC: 280 });

    await service.startAll();

    const { init } = drivers.latest(printer.id);
    expect(init).toEqual({
      printerId: printer.id,
      settings: { nozzleMaxC: 280, failCreate: false },
      storageDir: printerDir(paths, printer.id),
    });
    await expect(access(init.storageDir)).resolves.toBeUndefined();
  });

  it("leaves a printer with an unknown driver type offline, and starts the rest", async () => {
    const { published, service, statusOf, stored } = await setup();
    const gone = stored("Gone", {}, "klipper");
    const prusa = stored("Prusa");

    await service.startAll();

    expect(published(gone.id)).toEqual([
      connecting(),
      {
        type: "printer.status_changed",
        payload: {
          previous: "connecting",
          status: "offline",
          detail: START_FAILED_DETAIL,
          error: {
            code: "unknown_driver_type",
            message: 'There is no driver type "klipper".',
          },
        },
      },
    ]);
    expect(statusOf(prusa.id)).toBe("idle");
    expect(service.has(gone.id)).toBe(true);
  });

  it("leaves a printer whose stored settings no longer parse offline", async () => {
    const { drivers, service, store, stored } = await setup();
    const printer = stored("Prusa", { nozzleMaxC: "hot" });

    await service.startAll();

    expect(store.get(printer.id)?.state).toMatchObject({
      status: "offline",
      statusDetail: START_FAILED_DETAIL,
      error: { code: "invalid_settings" },
    });
    expect(store.get(printer.id)?.state.error?.message).toMatch(
      /^The stored settings don't suit the driver\. .*nozzleMaxC/s,
    );
    expect(drivers.created).toEqual([]);
  });
});

describe("PrinterService.add", () => {
  it("stores the row with every default, publishes printer.added, then starts the driver", async () => {
    const { bus, events, published, repos, service, store } = await setup();
    let rowAtAdded: unknown;
    bus.subscribe("probe", (event) => {
      if (event.type === "printer.added") {
        rowAtAdded = repos.printers.findById(event.printerId);
      }
    });

    const printer = await service.add({
      name: "Bench",
      driverType: TEST_DRIVER_TYPE,
      settings: { nozzleMaxC: 280 },
      userId: USER_ID,
    });

    expect(printer).toMatchObject({
      name: "Bench",
      driverType: TEST_DRIVER_TYPE,
      settings: { nozzleMaxC: 280, failCreate: false },
      settingsVersion: 1,
      createdAt: NOW,
      updatedAt: NOW,
    });
    expect(repos.printers.findById(printer.id)).toEqual(printer);
    expect(rowAtAdded).toEqual(printer);
    expect(published()).toEqual([
      {
        type: "printer.added",
        payload: { name: "Bench", driverType: TEST_DRIVER_TYPE },
      },
      connecting(),
      capabilitiesFor({ nozzleMaxC: 280 }),
      idle(),
    ]);
    expect(events[0]?.source).toEqual({ kind: "user", userId: USER_ID });
    expect(store.get(printer.id)?.printer).toEqual({
      id: printer.id,
      name: "Bench",
      driverType: TEST_DRIVER_TYPE,
    });
  });

  it("refuses an unknown driver type, writing and publishing nothing", async () => {
    const { events, repos, service } = await setup();

    await expectRefused(
      service.add({
        name: "X",
        driverType: "toString",
        settings: {},
        userId: USER_ID,
      }),
      "unknown_driver_type",
      'There is no driver type "toString".',
    );

    expect(repos.printers.list()).toEqual([]);
    expect(events).toEqual([]);
  });

  it("refuses invalid settings, with Zod's issues as details", async () => {
    const { events, repos, service } = await setup();

    const error: unknown = await service
      .add({
        name: "X",
        driverType: TEST_DRIVER_TYPE,
        settings: { nozzleMaxC: 0 },
        userId: USER_ID,
      })
      .catch((reason: unknown) => reason);

    expect(error).toBeInstanceOf(PrinterServiceError);
    expect(error).toMatchObject({
      code: "invalid_settings",
      details: [expect.objectContaining({ path: ["nozzleMaxC"] })],
    });
    expect((error as Error).message).toMatch(/^The settings aren't valid\. /);
    expect(repos.printers.list()).toEqual([]);
    expect(events).toEqual([]);
  });

  it("refuses a name another printer has, in any case", async () => {
    const { added, events, repos, service } = await setup();
    await added("Bench");

    await expectRefused(
      service.add({
        name: "BENCH",
        driverType: TEST_DRIVER_TYPE,
        settings: {},
        userId: USER_ID,
      }),
      "name_taken",
      "Another printer already has that name.",
    );

    expect(repos.printers.list()).toHaveLength(1);
    expect(events).toEqual([]);
  });

  it("adds a simulated printer through the real registry", async () => {
    const { drivers, published, repos, service, store } = await setup();

    const printer = await service.add({
      name: "Sim",
      driverType: "simulated",
      settings: { speedMultiplier: 60 },
      userId: USER_ID,
    });

    expect(drivers.created).toEqual([]);
    expect(repos.printers.findById(printer.id)?.settings).toEqual({
      printDurationS: 600,
      speedMultiplier: 60,
      heatUpS: 20,
      nozzleMaxC: 300,
      bedMaxC: 120,
      buildVolumeXMm: 256,
      buildVolumeYMm: 256,
      buildVolumeZMm: 256,
      maxMoveSpeedMmS: 200,
      cameraEnabled: true,
    });
    expect(store.get(printer.id)?.state).toMatchObject({
      status: "idle",
      capabilities: { extensions: ["simulator"] },
    });
    expect(published(printer.id).map((event) => event.type)).toEqual([
      "printer.added",
      "printer.status_changed",
      "printer.capabilities_changed",
      "printer.status_changed",
      "printer.telemetry",
      "printer.telemetry",
    ]);
  });
});

describe("PrinterService.update", () => {
  it("renames at once, without restarting the driver, even mid-print", async () => {
    const { added, published, repos, service, store } = await setup();
    const { printer, driver } = await added("Bench");
    driver.emit(status("printing"));
    await settle();

    const updated = await service.update(
      printer.id,
      { name: "Workshop" },
      USER_ID,
    );

    expect(updated).toEqual({ ...printer, name: "Workshop", updatedAt: NOW });
    expect(repos.printers.findById(printer.id)).toEqual(updated);
    expect(published().slice(1)).toEqual([
      { type: "printer.updated", payload: { changedFields: ["name"] } },
    ]);
    expect(store.get(printer.id)?.printer.name).toBe("Workshop");
    expect(driver.ops()).toEqual(["connect"]);
  });

  it("restarts the driver with new settings and bumps their version", async () => {
    const { added, bus, drivers, published, repos, service } = await setup();
    const { printer, driver } = await added("Bench");
    let versionAtUpdated: number | undefined;
    bus.subscribe("probe", (event) => {
      if (event.type === "printer.updated") {
        versionAtUpdated = repos.printers.findById(printer.id)?.settingsVersion;
      }
    });

    const updated = await service.update(
      printer.id,
      { settings: { nozzleMaxC: 280 } },
      USER_ID,
    );

    expect(updated).toMatchObject({
      settings: { nozzleMaxC: 280, failCreate: false },
      settingsVersion: 2,
      updatedAt: NOW,
    });
    expect(versionAtUpdated).toBe(2);
    expect(published()).toEqual([
      { type: "printer.updated", payload: { changedFields: ["settings"] } },
      {
        type: "printer.status_changed",
        payload: {
          previous: "idle",
          status: "offline",
          detail: null,
          error: null,
        },
      },
      connecting("offline"),
      capabilitiesFor({ nozzleMaxC: 280 }),
      idle(),
    ]);
    expect(driver.ops()).toEqual(["connect", "disconnect", "dispose"]);
    expect(drivers.latest(printer.id).init.settings).toEqual({
      nozzleMaxC: 280,
      failCreate: false,
    });
  });

  it("keeps the printer's folder across a restart", async () => {
    const { added, paths, service } = await setup();
    const { printer } = await added("Bench");
    const dir = printerDir(paths, printer.id);
    await writeFile(path.join(dir, "a.gcode"), "G28");

    await service.update(
      printer.id,
      { settings: { nozzleMaxC: 280 } },
      USER_ID,
    );

    expect(await readdir(dir)).toEqual(["a.gcode"]);
  });

  it("changes the name and settings in one event", async () => {
    const { added, published, service } = await setup();
    const { printer } = await added("Bench");

    const updated = await service.update(
      printer.id,
      { name: "Workshop", settings: { nozzleMaxC: 280 } },
      USER_ID,
    );

    expect(updated).toMatchObject({ name: "Workshop", settingsVersion: 2 });
    expect(published()[0]).toEqual({
      type: "printer.updated",
      payload: { changedFields: ["name", "settings"] },
    });
  });

  it("treats exactly the plan's five statuses as an active job", () => {
    expect([...JOB_STATUSES].sort()).toEqual([...ACTIVE_JOB].sort());
  });

  it.each(ACTIVE_JOB)(
    "refuses new settings while %s, changing nothing",
    async (jobStatus) => {
      const { added, events, repos, service } = await setup();
      const { printer, driver } = await added("Bench");
      driver.emit(status(jobStatus));
      await settle();
      events.length = 0;

      await expectRefused(
        service.update(
          printer.id,
          { name: "Workshop", settings: { nozzleMaxC: 280 } },
          USER_ID,
        ),
        "job_active",
        `The settings can't change while the printer is ${jobStatus}.`,
      );

      expect(repos.printers.findById(printer.id)).toEqual(printer);
      expect(events).toEqual([]);
      expect(driver.ops()).toEqual(["connect"]);
    },
  );

  it.each(
    PrinterStatusSchema.options.filter(
      (current) => !ACTIVE_JOB.includes(current),
    ),
  )("allows new settings while %s", async (current) => {
    const { added, service } = await setup();
    const { printer, driver } = await added("Bench");
    driver.emit(status(current));
    await settle();

    const updated = await service.update(
      printer.id,
      { settings: { nozzleMaxC: 280 } },
      USER_ID,
    );

    expect(updated.settingsVersion).toBe(2);
  });

  it("treats settings equal to the stored ones as no change, even mid-print", async () => {
    const { added, events, service } = await setup();
    const { printer, driver } = await added("Bench", { nozzleMaxC: 250 });
    driver.emit(status("printing"));
    await settle();
    events.length = 0;

    for (const settings of [{}, { nozzleMaxC: 250 }, DEFAULTS]) {
      expect(await service.update(printer.id, { settings }, USER_ID)).toEqual(
        printer,
      );
    }
    const renamed = await service.update(
      printer.id,
      { name: "Workshop", settings: {} },
      USER_ID,
    );

    expect(renamed.settingsVersion).toBe(1);
    expect(events.map(({ type, payload }) => ({ type, payload }))).toEqual([
      { type: "printer.updated", payload: { changedFields: ["name"] } },
    ]);
    expect(driver.ops()).toEqual(["connect"]);
  });

  it("publishes nothing when nothing changed", async () => {
    const { added, events, service } = await setup();
    const { printer } = await added("Bench");

    expect(
      await service.update(printer.id, { name: "Bench" }, USER_ID),
    ).toEqual(printer);
    expect(await service.update(printer.id, {}, USER_ID)).toEqual(printer);

    expect(events).toEqual([]);
  });

  it("refuses an unknown printer", async () => {
    const { service } = await setup();

    await expectRefused(
      service.update(
        "0199b3a0-1c00-7000-8000-000000000999",
        { name: "X" },
        USER_ID,
      ),
      "printer_not_found",
    );
  });

  it("refuses invalid settings and a taken name, changing nothing", async () => {
    const { added, events, repos, service } = await setup();
    await added("Workshop");
    const { printer } = await added("Bench");

    await expectRefused(
      service.update(printer.id, { settings: { nozzleMaxC: -1 } }, USER_ID),
      "invalid_settings",
    );
    await expectRefused(
      service.update(
        printer.id,
        { name: "WORKSHOP", settings: { nozzleMaxC: 280 } },
        USER_ID,
      ),
      "name_taken",
    );

    expect(repos.printers.findById(printer.id)).toEqual(printer);
    expect(events).toEqual([]);
  });

  it("refuses new settings for a driver type that's gone", async () => {
    const { service, stored } = await setup();
    const printer = stored("Gone", {}, "klipper");
    await service.startAll();

    await expectRefused(
      service.update(printer.id, { settings: {} }, USER_ID),
      "unknown_driver_type",
    );
  });

  it("starts a printer whose stored settings were broken, once they're fixed", async () => {
    const { service, statusOf, stored } = await setup();
    const printer = stored("Prusa", { nozzleMaxC: "hot" });
    await service.startAll();

    await service.update(
      printer.id,
      { settings: { nozzleMaxC: 280 } },
      USER_ID,
    );

    expect(statusOf(printer.id)).toBe("idle");
  });
});

describe("PrinterService.remove", () => {
  it("stops the driver, deletes the folder and row, then publishes printer.removed", async () => {
    const { added, events, paths, published, repos, service, store } =
      await setup();
    const { printer, driver } = await added("Bench");
    await writeFile(path.join(printerDir(paths, printer.id), "a.gcode"), "G28");

    await service.remove(printer.id, USER_ID);

    expect(driver.ops()).toEqual(["connect", "disconnect", "dispose"]);
    expect(await readdir(paths.printers)).toEqual([]);
    expect(repos.printers.findById(printer.id)).toBeUndefined();
    expect(published()).toEqual([
      {
        type: "printer.status_changed",
        payload: {
          previous: "idle",
          status: "offline",
          detail: null,
          error: null,
        },
      },
      { type: "printer.removed", payload: { name: "Bench" } },
    ]);
    expect(events.at(-1)?.source).toEqual({ kind: "user", userId: USER_ID });
    expect(store.get(printer.id)).toBeUndefined();
    expect(service.has(printer.id)).toBe(false);
  });

  it("works mid-print", async () => {
    const { added, repos, service } = await setup();
    const { printer, driver } = await added("Bench");
    driver.emit(status("printing"));
    await settle();

    await service.remove(printer.id, USER_ID);

    expect(repos.printers.list()).toEqual([]);
  });

  it("removes only that printer", async () => {
    const { added, paths, repos, service, statusOf } = await setup();
    const { printer: bench } = await added("Bench");
    const { printer: workshop } = await added("Workshop");

    await service.remove(bench.id, USER_ID);

    expect(await readdir(paths.printers)).toEqual([workshop.id]);
    expect(repos.printers.list()).toEqual([workshop]);
    expect(statusOf(workshop.id)).toBe("idle");
  });

  it("removes a printer whose driver never started", async () => {
    const { service, stored, types } = await setup();
    const printer = stored("Gone", {}, "klipper");
    await service.startAll();

    await service.remove(printer.id, USER_ID);

    expect(types().at(-1)).toBe("printer.removed");
  });

  it("refuses an unknown printer, and one already removed", async () => {
    const { added, service } = await setup();
    const { printer } = await added("Bench");
    await service.remove(printer.id, USER_ID);

    await expectRefused(
      service.remove(printer.id, USER_ID),
      "printer_not_found",
    );
    await expectRefused(
      service.update(printer.id, { name: "X" }, USER_ID),
      "printer_not_found",
    );
    await expectRefused(service.listFiles(printer.id), "printer_not_found");
  });
});

describe("PrinterService: one lifecycle step at a time", () => {
  it("runs a delete after a restart in progress", async () => {
    const { added, drivers, repos, service, types } = await setup();
    const { printer } = await added("Bench");
    let finish = () => {};
    drivers.handle(
      "connect",
      (_, driver) =>
        new Promise<void>((resolve) => {
          finish = () => {
            driver.emit(status("idle"));
            resolve();
          };
        }),
    );

    const restarting = service.update(
      printer.id,
      { settings: { nozzleMaxC: 280 } },
      USER_ID,
    );
    await vi.waitFor(() => expect(drivers.created).toHaveLength(2));
    const removing = service.remove(printer.id, USER_ID);
    await settle();
    expect(types()).not.toContain("printer.removed");

    finish();
    await restarting;
    await removing;

    expect(types().slice(-2)).toEqual([
      "printer.status_changed",
      "printer.removed",
    ]);
    expect(drivers.created.every((driver) => driver.disposed)).toBe(true);
    expect(repos.printers.list()).toEqual([]);
  });

  it("refuses an edit queued behind a delete, writing nothing", async () => {
    const { added, drivers, repos, service } = await setup();
    const { printer, driver } = await added("Bench");
    let finish = () => {};
    driver.handle(
      "disconnect",
      () => new Promise<void>((resolve) => (finish = resolve)),
    );

    const removing = service.remove(printer.id, USER_ID);
    const editing = service.update(
      printer.id,
      { settings: { nozzleMaxC: 280 } },
      USER_ID,
    );
    await vi.waitFor(() => expect(driver.ops()).toContain("disconnect"));
    finish();
    await removing;

    await expectRefused(editing, "printer_not_found");
    expect(repos.printers.list()).toEqual([]);
    expect(drivers.created).toHaveLength(1);
  });
});

describe("PrinterService.stopAll", () => {
  it("stops every driver, publishing their offline statuses", async () => {
    const { added, drivers, published, service } = await setup();
    await added("Bench");
    await added("Workshop");

    await service.stopAll();

    expect(drivers.created.map((driver) => driver.ops())).toEqual([
      ["connect", "disconnect", "dispose"],
      ["connect", "disconnect", "dispose"],
    ]);
    expect(published().map((event) => event.payload)).toEqual([
      { previous: "idle", status: "offline", detail: null, error: null },
      { previous: "idle", status: "offline", detail: null, error: null },
    ]);
  });
});

describe("PrinterService: reads", () => {
  it("asks the driver for files, cameras and snapshots, publishing nothing", async () => {
    const { added, events, service } = await setup();
    const { printer, driver } = await added("Bench");
    const files = [{ name: "a.gcode", sizeBytes: 3, modifiedAt: null }];
    const cameras = [{ id: "main", label: "Main" }];
    driver.handle("listFiles", () => ({ files }));
    driver.handle("listCameras", () => ({ cameras }));

    expect(await service.listFiles(printer.id)).toEqual({ files });
    expect(await service.listCameras(printer.id)).toEqual({ cameras });
    expect(await service.getSnapshot(printer.id, "main")).toMatchObject({
      mimeType: "image/png",
    });

    expect(driver.calls.slice(1)).toEqual([
      { op: "listFiles", args: {} },
      { op: "listCameras", args: {} },
      { op: "getSnapshot", args: { cameraId: "main" } },
    ]);
    expect(events).toEqual([]);
  });

  it("fails as offline when the driver isn't running", async () => {
    const { service, stored } = await setup();
    const printer = stored("Gone", {}, "klipper");
    await service.startAll();

    await expect(service.listFiles(printer.id)).rejects.toMatchObject({
      code: "offline",
    });
  });

  it("uses the 10 s timeout", async () => {
    const { added, service } = await setup();
    const { printer, driver } = await added("Bench");
    driver.handle("listFiles", () => new Promise(() => {}));
    const timeouts: number[] = [];
    const original = service.call.bind(service);
    service.call = (printerId, call, timeoutMs) => {
      timeouts.push(timeoutMs);
      return original(printerId, call, 1);
    };

    await expect(service.listFiles(printer.id)).rejects.toMatchObject({
      code: "timeout",
    });
    expect(timeouts).toEqual([CALL_TIMEOUT_MS]);
  });
});

describe("PrinterService: the transport", () => {
  const withDate = { type: "files_changed", when: new Date(0) };

  it("checks every driver message by default, as in development and test", async () => {
    const { added } = await setup();
    const { driver } = await added("Bench");

    expect(() => driver.emitUnchecked(withDate)).toThrow(TypeError);
  });

  it("passes messages by reference with cloning off, as in production", async () => {
    const { added } = await setup({ clone: false });
    const { driver } = await added("Bench");

    expect(() => driver.emitUnchecked(withDate)).not.toThrow();
  });
});
