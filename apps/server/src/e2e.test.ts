// SPDX-FileCopyrightText: 2026 Open Print Stack contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

// The whole server, as main.ts starts it, with the real simulated driver at
// 1000× speed: set up, add a printer, upload a file and print it over HTTP,
// watch it over the WebSocket until it's idle again, then stop the server and
// read what the database kept. Real timers: it takes about 3 s.

import path from "node:path";

import type {
  OpsEvent,
  PrinterStatus,
  WsServerMessage,
} from "@openprintstack/protocol";
import { describe, expect, it, onTestFinished } from "vitest";

import { SESSION_COOKIE } from "./auth/sessions.ts";
import { openDatabase } from "./db/client.ts";
import { createRepos } from "./db/repos/index.ts";
import { startServer } from "./server.ts";
import { debugLogger, tempDir } from "./test-utils.ts";
import { TestClient } from "./ws/test-client.ts";

const GCODE = "G28\nG1 Z0.2 F600\nG1 X50 Y50 E5\n";

describe("the whole system", () => {
  it(
    "prints a file on a simulated printer at 1000×, from upload to idle, and keeps every event",
    { timeout: 30_000 },
    async () => {
      const dataDir = await tempDir();
      const { logger } = await debugLogger();
      const server = await startServer({
        config: {
          env: "test",
          host: "127.0.0.1",
          port: 0,
          allowedHosts: [],
          dataDir,
          logLevel: "debug",
          telemetry: { sampleIntervalMs: 5000, retentionDays: 7 },
        },
        logger,
      });
      onTestFinished(async () => {
        await server.stop();
      });
      let token = "";
      const call = (method: string, url: string, body?: unknown) =>
        fetch(`${server.url}${url}`, {
          method,
          headers: {
            origin: server.url,
            cookie: `${SESSION_COOKIE}=${token}`,
            ...(typeof body === "string"
              ? { "content-type": "application/octet-stream" }
              : body !== undefined && { "content-type": "application/json" }),
          },
          ...(body !== undefined && {
            body: typeof body === "string" ? body : JSON.stringify(body),
          }),
        });

      // Set up and add the printer.
      const setup = await call("POST", "/api/auth/setup", {
        username: "rob",
        password: "correct horse battery",
      });
      expect(setup.status).toBe(201);
      token = /ops_session=([^;]*)/.exec(
        setup.headers.get("set-cookie") ?? "",
      )![1]!;
      const { user } = (await setup.json()) as { user: { id: string } };
      const added = await call("POST", "/api/printers", {
        name: "Sim",
        driverType: "simulated",
        settings: { speedMultiplier: 1000 },
      });
      expect(added.status).toBe(201);
      const { id: printerId } = (await added.json()) as { id: string };

      // Watch it.
      const client = await TestClient.connect(server.url, { token });
      const topic = { name: "printer", printerId } as const;
      client.send({ type: "subscribe", topic });
      expect(
        await client.nextMatching((m) => m.type === "snapshot"),
      ).toMatchObject({ data: { state: { status: "idle" } } });

      // Upload and print.
      const uploaded = await call(
        "PUT",
        `/api/printers/${printerId}/files/benchy.gcode`,
        GCODE,
      );
      expect(uploaded.status).toBe(200);
      const files = (await (
        await call("GET", `/api/printers/${printerId}/files`)
      ).json()) as { files: { name: string; sizeBytes: number | null }[] };
      expect(files.files).toEqual([
        expect.objectContaining({
          name: "benchy.gcode",
          sizeBytes: GCODE.length,
        }) as unknown,
      ]);
      const started = await call(
        "POST",
        `/api/printers/${printerId}/commands`,
        { kind: "print.start", fileName: "benchy.gcode" },
      );
      expect(started.status).toBe(200);

      // Until it's idle again: preparing, printing, completed.
      const event = (
        m: WsServerMessage,
      ): m is Extract<WsServerMessage, { type: "event" }> => m.type === "event";
      const isStatus = (e: OpsEvent, status: PrinterStatus) =>
        e.type === "printer.status_changed" && e.payload.status === status;
      const ended = await client.nextMatching(
        (m) => event(m) && m.event.type === "printer.job_ended",
        20_000,
      );
      await client.nextMatching((m) => event(m) && isStatus(m.event, "idle"));
      const statuses = client.messages
        .filter(event)
        .flatMap((m) =>
          m.event.type === "printer.status_changed"
            ? [m.event.payload.status]
            : [],
        );
      expect(statuses).toEqual(["preparing", "printing", "idle"]);
      expect(ended).toMatchObject({
        topic,
        event: { payload: { outcome: "completed", fileName: "benchy.gcode" } },
      });

      // What the database kept.
      await server.stop();
      const db = openDatabase(path.join(dataDir, "ops.sqlite"));
      onTestFinished(() => {
        db.$client.close();
      });
      const stored = createRepos(db)
        .events.page({ includeTelemetry: false, limit: 500 })
        .events.reverse();
      const types = stored.map((e) => e.type);

      expect(types[0]).toBe("system.started");
      expect(types.slice(-2)).toEqual([
        "system.stopping",
        "printer.status_changed",
      ]);
      expect(stored.at(-1)).toMatchObject({
        payload: { status: "offline" },
      });
      const jobEnded = stored.filter((e) => e.type === "printer.job_ended");
      expect(jobEnded).toEqual([
        expect.objectContaining({
          printerId,
          source: { kind: "driver" },
          payload: { outcome: "completed", fileName: "benchy.gcode" },
        }) as unknown,
      ]);

      // Each command: requested then result, both by rob, sharing its id.
      const commands = stored.filter((e) => e.category === "command");
      expect(
        commands.map((e) =>
          e.type === "command.requested"
            ? `requested ${e.payload.command.kind}`
            : `result ${e.type === "command.result" && e.payload.ok}`,
        ),
      ).toEqual([
        "requested file.upload",
        "result true",
        "requested print.start",
        "result true",
      ]);
      for (const e of commands) {
        expect(e.source).toEqual({ kind: "user", userId: user.id });
        expect(e.printerId).toBe(printerId);
      }
      for (const [requested, result] of [
        [commands[0], commands[1]],
        [commands[2], commands[3]],
      ]) {
        expect(requested?.correlationId).not.toBeNull();
        expect(result?.correlationId).toBe(requested?.correlationId);
        expect(requested?.payload).toMatchObject({
          commandId: requested?.correlationId,
        });
      }

      // In order: the upload finished before the print was asked for, and
      // the job started after that and ended before the printer was idle.
      const at = (match: (e: OpsEvent) => boolean) => stored.findIndex(match);
      const printRequested = at(
        (e) =>
          e.type === "command.requested" &&
          e.payload.command.kind === "print.start",
      );
      const jobStarted = at((e) => e.type === "printer.job_started");
      const jobEndedAt = at((e) => e.type === "printer.job_ended");
      const idleAfter = stored.findIndex(
        (e, i) => i > jobEndedAt && isStatus(e, "idle"),
      );
      expect(at((e) => e === commands[1])).toBeLessThan(printRequested);
      expect(printRequested).toBeLessThan(jobStarted);
      expect(jobStarted).toBeLessThan(jobEndedAt);
      expect(jobEndedAt).toBeLessThan(idleAfter);
    },
  );
});
