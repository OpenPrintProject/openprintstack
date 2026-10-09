// SPDX-FileCopyrightText: 2026 Open Print Stack contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

import {
  type DriverContext,
  DriverError,
  type DriverInit,
  type DriverMessage,
  type ListCamerasResult,
  type ListFilesResult,
  type LogData,
  type PrinterDriver,
  type Snapshot,
  type TelemetryPatch,
} from "@openprintstack/driver-sdk";
import { type ErrorInfo, hasActiveJob } from "@openprintstack/protocol";

import { cc2Capabilities } from "./capabilities.ts";
import { identifyPrinter, type PrinterIdentity } from "./identify.ts";
import { JobMemory, NO_JOBS, trackJobs } from "./jobs.ts";
import {
  DISCOVERY_PORT,
  type JsonObject,
  METHOD,
  type MethodMessage,
  MQTT_PORT,
} from "./protocol.ts";
import { numberAt } from "./read.ts";
import { Cc2Session, OpenError } from "./session.ts";
import type { Cc2Settings } from "./settings.ts";
import { StatusFeed } from "./status-feed.ts";
import {
  describeException,
  exceptionCodes,
  type MappedStatus,
  mapStatus,
} from "./status-map.ts";
import { readJob, readPrint, readTelemetry } from "./telemetry.ts";

// The connection to one CC2. Read-only for now: it reports status, telemetry
// and jobs; commands, files and the camera come in later PRs.
//
// Each attempt asks the printer for its serial number by UDP (once; later
// attempts reuse it until one fails), then opens an MQTT session and asks for
// the full status. Deltas are merged into it from then on, and everything that
// changed is reported. When an attempt fails or the session drops, the driver
// reports `offline` with the reason and tries again after a backoff.

/** The printer's ports. Tests point them at a fake printer. */
export type Cc2Ports = {
  readonly mqtt: number;
  readonly udp: number;
};

export const CC2_PORTS: Cc2Ports = { mqtt: MQTT_PORT, udp: DISCOVERY_PORT };

/** Every delay the driver uses, in milliseconds. Tests shorten them. */
export type Cc2Timings = {
  /**
   * The most one attempt may take, from the serial-number query to the full
   * status. The host allows 10 s for the first one.
   */
  readonly attemptMs: number;
  /** How long to wait for the serial number, and how often to ask. */
  readonly identifyMs: number;
  readonly identifyRetryMs: number;
  /** How long the MQTT login, the registration and a request may take. */
  readonly connectMs: number;
  readonly registerMs: number;
  readonly requestMs: number;
  /** How often to PING, and how long a silent printer counts as gone. */
  readonly heartbeatMs: number;
  readonly silenceMs: number;
  /** The waits between attempts; the last one repeats. */
  readonly backoffMs: readonly number[];
};

export const CC2_TIMINGS: Cc2Timings = {
  attemptMs: 8000,
  identifyMs: 2000,
  identifyRetryMs: 500,
  connectMs: 3000,
  registerMs: 3000,
  requestMs: 3000,
  heartbeatMs: 10_000,
  silenceMs: 30_000,
  backoffMs: [2000, 4000, 8000, 16_000, 30_000],
};

/** Where the driver keeps its job memory, in the printer's own folder. */
export const JOBS_FILE = "jobs.json";

const SILENT_DETAIL = "The printer stopped answering. Reconnecting.";
const LOST_DETAIL = "Lost the connection to the printer. Reconnecting.";
const RETRYING_DETAIL = "Retrying.";

export const OFFLINE_ERRORS = {
  lanOnlyOff: {
    code: "lan_only_off",
    message:
      "LAN Only mode is off. Turn it on in the printer's network settings.",
  },
  noAccessCode: {
    code: "no_access_code",
    message:
      "The printer has no access code. Set one in its network settings, then enter it here.",
  },
  accessCodeRejected: {
    code: "access_code_rejected",
    message:
      "The printer refused the access code. Check it on the printer, then edit this printer.",
  },
  tooManyClients: {
    code: "too_many_clients",
    message:
      "The printer has too many connections (it allows about 4). Close ElegooSlicer or the printer's web page on another computer.",
  },
} as const satisfies Record<string, ErrorInfo>;

const NOT_YET =
  "The CC2 driver only monitors the printer so far: commands, files and the camera come in a later version.";

/** Why the printer is offline, as its status shows it. */
type Failure = {
  readonly detail: string | null;
  readonly error: ErrorInfo | null;
};

type Attempt =
  | { readonly ok: true; readonly session: Cc2Session }
  | ({ readonly ok: false } & Failure);

/** What the host last received, as JSON, so that only changes are sent. */
type Sent = {
  status?: string;
  job?: string;
  telemetry: Record<string, string>;
};

export class Cc2Driver implements PrinterDriver {
  readonly #settings: Cc2Settings;
  readonly #ctx: DriverContext;
  readonly #ports: Cc2Ports;
  readonly #timings: Cc2Timings;
  readonly #jobsPath: string;

  /** The connect loop, from `connect` until `disconnect` or `dispose`. */
  #loop: Promise<void> | null = null;
  /** Stops the loop: aborts an attempt or a backoff wait. */
  #stop: AbortController | null = null;
  #session: Cc2Session | null = null;
  #identity: PrinterIdentity | null = null;
  readonly #feed = new StatusFeed();
  #online = false;
  #sent: Sent = { telemetry: {} };
  #jobs: JobMemory | null = null;
  /** Job memory writes, in order. `dispose` waits for them. */
  #saving: Promise<void> = Promise.resolve();
  /** The layer count from the file's details, for the job it's for. */
  #layers: { uuid: string; total: number | null } | null = null;
  #refetching = false;
  /** Problem codes already raised as alerts. */
  #exceptions = new Set<number>();
  #disposed = false;

  constructor(
    init: DriverInit<Cc2Settings>,
    ctx: DriverContext,
    ports: Cc2Ports,
    timings: Cc2Timings,
  ) {
    this.#settings = init.settings;
    this.#ctx = ctx;
    this.#ports = ports;
    this.#timings = timings;
    this.#jobsPath = join(init.storageDir, JOBS_FILE);
  }

  // Connection

  async connect(): Promise<void> {
    if (this.#disposed || this.#loop !== null) return;
    this.#jobs ??= await this.#loadJobs();
    const firstAttempt = Promise.withResolvers<void>();
    const stop = new AbortController();
    this.#stop = stop;
    this.#loop = this.#run(stop.signal, firstAttempt.resolve).finally(() => {
      firstAttempt.resolve();
      if (this.#stop === stop) {
        this.#loop = null;
        this.#stop = null;
      }
    });
    await firstAttempt.promise;
  }

  async disconnect(): Promise<void> {
    await this.#halt();
    this.#goOffline({ detail: null, error: null });
  }

  async dispose(): Promise<void> {
    // #emit checks this, so nothing is reported from here on.
    this.#disposed = true;
    await this.#halt();
    await this.#saving;
  }

  // Not yet: the host never calls these, as the capabilities don't offer them.

  listFiles(): Promise<ListFilesResult> {
    return Promise.reject(new DriverError("not_supported", NOT_YET));
  }

  sendFile(): Promise<void> {
    return Promise.reject(new DriverError("not_supported", NOT_YET));
  }

  startPrint(): Promise<void> {
    return Promise.reject(new DriverError("not_supported", NOT_YET));
  }

  pause(): Promise<void> {
    return Promise.reject(new DriverError("not_supported", NOT_YET));
  }

  resume(): Promise<void> {
    return Promise.reject(new DriverError("not_supported", NOT_YET));
  }

  cancel(): Promise<void> {
    return Promise.reject(new DriverError("not_supported", NOT_YET));
  }

  home(): Promise<void> {
    return Promise.reject(new DriverError("not_supported", NOT_YET));
  }

  move(): Promise<void> {
    return Promise.reject(new DriverError("not_supported", NOT_YET));
  }

  setTemperature(): Promise<void> {
    return Promise.reject(new DriverError("not_supported", NOT_YET));
  }

  setFan(): Promise<void> {
    return Promise.reject(new DriverError("not_supported", NOT_YET));
  }

  listCameras(): Promise<ListCamerasResult> {
    return Promise.resolve({ cameras: [] });
  }

  getSnapshot(): Promise<Snapshot> {
    return Promise.reject(new DriverError("not_supported", NOT_YET));
  }

  // The connect loop

  /**
   * Connects, waits for the session to close, and connects again, with a
   * backoff after each failure or drop, until `signal` aborts.
   */
  async #run(signal: AbortSignal, firstAttemptDone: () => void) {
    const backoff = this.#timings.backoffMs;
    let failures = 0;
    try {
      while (!signal.aborted) {
        const attempt = await this.#attempt(signal);
        if (attempt.ok) {
          firstAttemptDone();
          failures = 0;
          const reason = await attempt.session.closed;
          this.#session = null;
          if (signal.aborted) return;
          this.#goOffline({
            detail: reason === "silent" ? SILENT_DETAIL : LOST_DETAIL,
            error: null,
          });
          this.#log("warn", "The connection to the printer dropped.", {
            reason,
          });
        } else {
          // Ask for the serial number again next time: the printer may have
          // changed (e.g. LAN Only switched off), and its answer says so.
          this.#identity = null;
          this.#goOffline(attempt);
          firstAttemptDone();
        }
        const wait = backoff[Math.min(failures, backoff.length - 1)] ?? 0;
        failures += 1;
        await sleep(wait, undefined, { signal });
      }
    } catch (error) {
      // Stopping aborts the wait or the attempt; anything else is a bug.
      if (!signal.aborted) {
        this.#log("error", "The connect loop stopped unexpectedly.", {
          error: String(error),
        });
      }
    }
  }

  /** One attempt, which either opens a session or says why it couldn't. */
  async #attempt(stop: AbortSignal): Promise<Attempt> {
    const timings = this.#timings;
    const { host, accessCode } = this.#settings;
    const signal = AbortSignal.any([
      stop,
      AbortSignal.timeout(timings.attemptMs),
    ]);
    const noAnswer = {
      ok: false,
      detail: `No answer from ${host}. Retrying.`,
      error: null,
    } as const;
    let session: Cc2Session | null = null;
    try {
      let identity = this.#identity;
      if (identity === null) {
        identity = await identifyPrinter(host, this.#ports.udp, {
          timeoutMs: timings.identifyMs,
          retryMs: timings.identifyRetryMs,
          signal,
        });
        if (identity === null) return noAnswer;
        if (identity.lanOnly === false) {
          return this.#failed(OFFLINE_ERRORS.lanOnlyOff);
        }
        if (identity.accessCodeSet === false) {
          return this.#failed(OFFLINE_ERRORS.noAccessCode);
        }
        this.#identity = identity;
      }

      this.#feed.reset();
      session = await Cc2Session.open(
        {
          host,
          port: this.#ports.mqtt,
          serial: identity.serial,
          accessCode,
          connectMs: timings.connectMs,
          registerMs: timings.registerMs,
          requestMs: timings.requestMs,
          heartbeatMs: timings.heartbeatMs,
          silenceMs: timings.silenceMs,
          signal,
        },
        { onStatusEvent: (event) => this.#onStatusEvent(event) },
      );
      const full = await untilAborted(
        session.request(METHOD.getStatus),
        signal,
      );
      this.#session = session;
      this.#goOnline(this.#feed.full(full));
      this.#log("info", "Connected to the printer.", {
        name: identity.name,
        model: identity.model,
        clientId: session.clientId,
      });
      return { ok: true, session };
    } catch (error) {
      await session?.close();
      if (stop.aborted) throw error;
      if (error instanceof OpenError) {
        switch (error.failure.kind) {
          case "access_code_rejected":
            return this.#failed(OFFLINE_ERRORS.accessCodeRejected);
          case "too_many_clients":
            return this.#failed(OFFLINE_ERRORS.tooManyClients);
          case "register_failed":
            return this.#failed({
              code: "register_failed",
              message: `The printer refused the connection: ${error.failure.reason}.`,
            });
          case "unreachable":
            break;
        }
      }
      this.#log("debug", "An attempt to connect failed.", {
        error: error instanceof Error ? error.message : String(error),
      });
      return noAnswer;
    }
  }

  #failed(error: ErrorInfo): Attempt {
    return { ok: false, detail: RETRYING_DETAIL, error };
  }

  /** Stops the loop and closes the session, without reporting anything. */
  async #halt(): Promise<void> {
    this.#stop?.abort();
    await this.#session?.close();
    await this.#loop;
  }

  // Status

  #onStatusEvent({ id, method, result }: MethodMessage): void {
    if (method !== METHOD.statusEvent) return;
    const { status, refetch } = this.#feed.delta(id, result);
    if (!this.#online) return;
    if (refetch) {
      this.#log("warn", "Missed status updates; asking for the full status.", {
        id,
      });
      this.#refetch();
    }
    if (status !== null) {
      this.#sync(status);
    }
  }

  /** Asks for the full status again, after missed deltas. */
  #refetch(): void {
    const session = this.#session;
    if (session === null || this.#refetching) return;
    this.#refetching = true;
    session
      .request(METHOD.getStatus)
      .then((full) => {
        if (this.#session === session && this.#online) {
          this.#sync(this.#feed.full(full));
        }
      })
      .catch((error: unknown) => {
        this.#log("warn", "Couldn't get the full status again.", {
          error: error instanceof Error ? error.message : String(error),
        });
      })
      .finally(() => {
        this.#refetching = false;
      });
  }

  /**
   * Reports everything, as the host has nothing: it resets its telemetry
   * whenever a printer goes offline. The status comes first, so the printer is
   * back before anything that happened while it was away.
   */
  #goOnline(status: JsonObject): void {
    this.#online = true;
    this.#sent = { telemetry: {} };
    this.#emit({ type: "capabilities", capabilities: cc2Capabilities() });
    this.#emitStatus(mapStatus(status));
    this.#sync(status);
  }

  #goOffline(failure: Failure): void {
    this.#online = false;
    this.#emitStatus({ status: "offline", ...failure });
  }

  /**
   * Reports what the printer's new status changed, in order: job events and
   * alerts, then the job's progress, the telemetry and the status. So a
   * finished print reports `completed`, then `job: null`, then `idle`.
   */
  #sync(status: JsonObject): void {
    this.#syncJobs(status);
    this.#syncExceptions(status);

    const mapped = mapStatus(status);
    const job = hasActiveJob(mapped.status)
      ? readJob(status, this.#totalLayers(status))
      : null;
    const jobJson = JSON.stringify(job);
    if (jobJson !== this.#sent.job) {
      this.#sent.job = jobJson;
      this.#emit({ type: "job", job });
    }

    const patch: TelemetryPatch = {};
    for (const [key, value] of Object.entries(readTelemetry(status))) {
      const json = JSON.stringify(value);
      if (this.#sent.telemetry[key] !== json) {
        this.#sent.telemetry[key] = json;
        Object.assign(patch, { [key]: value });
      }
    }
    if (Object.keys(patch).length > 0) {
      this.#emit({ type: "telemetry", telemetry: patch });
    }

    this.#emitStatus(mapped);
  }

  #syncJobs(status: JsonObject): void {
    const before = this.#jobs ?? NO_JOBS;
    const { memory, changes } = trackJobs(before, status);
    if (changes.length === 0 && memory.endedUuid === before.endedUuid) return;
    this.#jobs = memory;
    this.#saveJobs(memory);
    for (const { event, fileName, unreported } of changes) {
      if (unreported) {
        this.#log(
          "warn",
          "A job ended while the printer was out of touch, and it didn't say how, so it's reported as failed.",
          { fileName },
        );
      }
      this.#emit({ type: "job_lifecycle", event, fileName });
    }
  }

  /** Raises an alert for each problem code the printer hasn't had before. */
  #syncExceptions(status: JsonObject): void {
    const codes = exceptionCodes(status);
    for (const code of codes) {
      if (!this.#exceptions.has(code)) {
        this.#emit({
          type: "alert",
          severity: "warning",
          code: `cc2_exception_${code}`,
          message: describeException(code),
        });
      }
    }
    this.#exceptions = new Set(codes);
  }

  /**
   * The job's layer count when the status leaves it out: asked for once per
   * job, from the file's details (method 1046). Null until it answers.
   */
  #totalLayers(status: JsonObject): number | null {
    const print = readPrint(status);
    if (print.totalLayers !== null || print.uuid === null) return null;
    if (this.#layers?.uuid === print.uuid) return this.#layers.total;

    const layers = { uuid: print.uuid, total: null as number | null };
    this.#layers = layers;
    const session = this.#session;
    if (session === null || print.fileName === null) return null;
    session
      .request(METHOD.getFileDetail, {
        storage_media: "local",
        filename: print.fileName,
      })
      .then((detail) => {
        const total =
          numberAt(detail, "TotalLayers") ??
          numberAt(detail, "layer") ??
          numberAt(detail, "total_layer");
        if (total === null || total <= 0) return;
        layers.total = total;
        const current = this.#feed.status;
        if (this.#online && this.#layers === layers && current !== null) {
          this.#sync(current);
        }
      })
      .catch((error: unknown) => {
        this.#log("debug", "Couldn't get the file's layer count.", {
          error: error instanceof Error ? error.message : String(error),
        });
      });
    return null;
  }

  // Job memory

  async #loadJobs(): Promise<JobMemory> {
    let text: string;
    try {
      text = await readFile(this.#jobsPath, "utf8");
    } catch {
      // Not there yet: this printer has never had a job.
      return NO_JOBS;
    }
    try {
      return JobMemory.parse(JSON.parse(text));
    } catch {
      this.#log("warn", "The job memory couldn't be read; starting afresh.", {
        file: this.#jobsPath,
      });
      return NO_JOBS;
    }
  }

  #saveJobs(memory: JobMemory): void {
    const json = JSON.stringify(memory);
    this.#saving = this.#saving
      .then(() => writeFile(this.#jobsPath, json))
      .catch((error: unknown) => {
        this.#log("warn", "Couldn't save the job memory.", {
          error: error instanceof Error ? error.message : String(error),
        });
      });
  }

  // Reporting

  /** Sends the status if it changed. */
  #emitStatus(status: MappedStatus): void {
    const json = JSON.stringify(status);
    if (json === this.#sent.status) return;
    this.#sent.status = json;
    this.#emit({ type: "status", ...status });
  }

  #emit(message: DriverMessage): void {
    if (!this.#disposed) {
      this.#ctx.emit(message);
    }
  }

  /** As `ctx.log`, but through `#emit`, so nothing is logged after dispose. */
  #log(
    level: "debug" | "info" | "warn" | "error",
    message: string,
    data: LogData,
  ): void {
    this.#emit({ type: "log", level, message, data });
  }
}

/** Settles as `promise` does, or rejects with the reason if `signal` aborts. */
function untilAborted<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  signal.throwIfAborted();
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(signal.reason as Error);
    signal.addEventListener("abort", abort, { once: true });
    promise.then(resolve, reject).finally(() => {
      signal.removeEventListener("abort", abort);
    });
  });
}
