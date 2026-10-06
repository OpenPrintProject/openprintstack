// SPDX-FileCopyrightText: 2026 Open Print Stack contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { PrinterStatus, WsServerMessage } from "@openprintstack/protocol";
import { telemetryFixture } from "@openprintstack/protocol/fixtures";
import { describe, expect, it } from "vitest";

import {
  SESSION_TOUCH_INTERVAL_MS,
  SESSION_TTL_MS,
  sessionIdOf,
} from "../auth/sessions.ts";
import type { EventDraft } from "../bus/bus.ts";
import {
  apiError,
  PASSWORD,
  sessionCookie,
  START,
  type TestApp,
  testApp,
  type TestAppOptions,
} from "../http/test-app.ts";
import { jsonLines, settle } from "../test-utils.ts";
import { serveTestApp, TestClient, upgradeStatus } from "./test-client.ts";

const driver = { kind: "driver" } as const;

function status(printerId: string, to: PrinterStatus): EventDraft {
  return {
    type: "printer.status_changed",
    printerId,
    source: driver,
    payload: { previous: null, status: to, detail: null, error: null },
  };
}

function telemetry(printerId: string, speedPercent: number): EventDraft {
  return {
    type: "printer.telemetry",
    printerId,
    source: driver,
    payload: {
      telemetry: { ...structuredClone(telemetryFixture), speedPercent },
    },
  };
}

/** The test app on a real socket, with the admin logged in. */
async function served(options: TestAppOptions = {}) {
  const t = await testApp(options);
  const { url } = await serveTestApp(t);
  const { token, user } = await t.setupAdmin();
  return { t, url, token, user };
}

/** Logs in again, starting a second session. */
async function login(t: TestApp): Promise<string> {
  const response = await t.call("POST", "/api/auth/login", {
    json: { username: "rob", password: PASSWORD },
  });
  expect(response.status).toBe(200);
  return sessionCookie(response) ?? "";
}

async function expectPong(client: TestClient): Promise<void> {
  client.send({ type: "ping" });
  expect(await client.nextMatching((m) => m.type === "pong")).toEqual({
    type: "pong",
  });
}

describe("the upgrade at /api/ws", () => {
  it("opens with hello: the boot id and the user", async () => {
    const { t, url, token, user } = await served();

    const client = await TestClient.connect(url, { token });

    expect(await client.next()).toEqual({
      type: "hello",
      bootId: t.bus.bootId,
      user,
    });
  });

  it("refuses an upgrade without a session: 401", async () => {
    const { url } = await served();

    expect(await upgradeStatus(url)).toBe(401);
    expect(await upgradeStatus(url, { token: "x".repeat(43) })).toBe(401);
  });

  it("refuses with 401 before anyone has set up", async () => {
    const t = await testApp();
    const { url } = await serveTestApp(t);

    expect(await upgradeStatus(url)).toBe(401);
  });

  it.each([
    ["another site", "http://evil.example"],
    ["another port", "http://127.0.0.1:1"],
    ["https", "https://127.0.0.1"],
    ["null", "null"],
  ])("refuses an Origin from %s: 403", async (_name, origin) => {
    const { url, token } = await served();

    expect(await upgradeStatus(url, { token, origin })).toBe(403);
  });

  it("refuses an upgrade without an Origin: 403", async () => {
    const { url, token } = await served();

    expect(await upgradeStatus(url, { token, origin: null })).toBe(403);
  });

  it("checks the Origin before the session", async () => {
    const { url } = await served();

    expect(await upgradeStatus(url, { origin: "http://evil.example" })).toBe(
      403,
    );
  });

  it("refuses a Host the server doesn't answer to: 403", async () => {
    const { url, token } = await served();

    expect(
      await upgradeStatus(url, {
        token,
        host: "evil.example",
        origin: "http://evil.example",
      }),
    ).toBe(403);
  });

  it("takes another allowed host name, with its own origin", async () => {
    const { url, token } = await served({
      config: { allowedHosts: ["printers.local"] },
    });

    const client = await TestClient.connect(url, {
      token,
      host: "printers.local:7337",
      origin: "http://printers.local:7337",
    });

    expect((await client.next()).type).toBe("hello");
  });

  it("publishes nothing for a refused upgrade", async () => {
    const { t, url } = await served();
    const before = t.events.length;

    await upgradeStatus(url, { origin: "http://evil.example" });
    await upgradeStatus(url);

    expect(t.events.length).toBe(before);
  });

  it("sends the renewed session cookie with the 101 when the upgrade slides the session", async () => {
    const { t, url, token } = await served();
    t.advance(SESSION_TOUCH_INTERVAL_MS);

    const client = await TestClient.connect(url, { token });

    expect(client.upgradeHeaders["set-cookie"]).toEqual([
      `ops_session=${token}; Max-Age=${SESSION_TTL_MS / 1000}; Path=/; HttpOnly; SameSite=Lax`,
    ]);
  });
});

describe("a plain GET of /api/ws", () => {
  it("answers 426 upgrade_required with Upgrade: websocket", async () => {
    const t = await testApp();
    const { token } = await t.setupAdmin();

    const answer = await t.call("GET", "/api/ws", {
      token,
      origin: "http://localhost",
    });

    expect(answer.status).toBe(426);
    expect(answer.headers.get("upgrade")).toBe("websocket");
    expect(await apiError(answer)).toEqual({
      code: "upgrade_required",
      message:
        "This is the WebSocket endpoint: connect to it with a WebSocket client.",
    });
  });

  it("checks Origin, then the session, before that", async () => {
    const t = await testApp();
    const { token } = await t.setupAdmin();

    const noOrigin = await t.call("GET", "/api/ws", { token });
    const noSession = await t.call("GET", "/api/ws", {
      origin: "http://localhost",
    });

    expect(noOrigin.status).toBe(403);
    expect(await apiError(noOrigin)).toEqual({
      code: "origin_not_allowed",
      message:
        "Send an Origin header: WebSocket connections must come from this server's own pages.",
    });
    expect(noSession.status).toBe(401);
  });
});

describe("snapshot, then events", () => {
  it("sends a printer's snapshot, then its events in order", async () => {
    const { t, url, token } = await served();
    const printerId = await t.addPrinter(token);
    const client = await TestClient.connect(url, { token });
    await client.next();
    const topic = { name: "printer", printerId } as const;

    client.send({ type: "subscribe", topic });
    const snapshot = await client.next();
    t.bus.publish(status(printerId, "busy"));
    t.bus.publish(telemetry(printerId, 120));
    t.bus.publish(status(printerId, "idle"));

    expect(snapshot).toEqual({
      type: "snapshot",
      topic,
      seq: t.store.seq - 3,
      data: expect.objectContaining({
        state: expect.objectContaining({ status: "idle" }) as unknown,
      }) as unknown,
    });
    const events = [
      await client.next(),
      await client.next(),
      await client.next(),
    ];
    expect(
      events.map((m) =>
        m.type === "event" ? [m.topic, m.event.type, m.event.seq] : m.type,
      ),
    ).toEqual([
      [topic, "printer.status_changed", t.store.seq - 2],
      [topic, "printer.telemetry", t.store.seq - 1],
      [topic, "printer.status_changed", t.store.seq],
    ]);
  });

  it("delivers the events of a command to the events topic, with the user", async () => {
    const { t, url, token, user } = await served();
    const printerId = await t.addPrinter(token);
    const client = await TestClient.connect(url, { token });
    client.send({ type: "subscribe", topic: { name: "events", printerId } });
    await client.nextMatching((m) => m.type === "snapshot");

    const answer = await t.call("POST", `/api/printers/${printerId}/commands`, {
      token,
      json: { kind: "motion.home", axes: [] },
    });

    expect(answer.status).toBe(200);
    const requested = await client.nextMatching(
      (m) => m.type === "event" && m.event.type === "command.requested",
    );
    const result = await client.nextMatching(
      (m) => m.type === "event" && m.event.type === "command.result",
    );
    expect(requested).toMatchObject({
      event: { source: { kind: "user", userId: user.id } },
    });
    expect(result).toMatchObject({ event: { payload: { ok: true } } });
  });
});

describe("sessions ending", () => {
  it("closes the session's sockets with 4401 on logout, and only those", async () => {
    const { t, url, token } = await served();
    const other = await login(t);
    const mine = [
      await TestClient.connect(url, { token }),
      await TestClient.connect(url, { token }),
    ];
    const theirs = await TestClient.connect(url, { token: other });

    const answer = await t.call("POST", "/api/auth/logout", { token });

    expect(answer.status).toBe(204);
    for (const client of mine) {
      expect(await client.closing()).toEqual({
        code: 4401,
        reason: "The session has ended.",
      });
    }
    await expectPong(theirs);
  });

  it("closes a socket whose session expired, at the next keep-alive round", async () => {
    const { t, url, token } = await served();
    const client = await TestClient.connect(url, { token });
    await client.next();

    t.at(START + SESSION_TTL_MS);
    t.hub.heartbeat();

    expect((await client.closing()).code).toBe(4401);
  });

  it("closes a socket whose session the pruner deleted, at the next round", async () => {
    const { t, url, token } = await served();
    const other = await login(t);
    const client = await TestClient.connect(url, { token });
    const survivor = await TestClient.connect(url, { token: other });
    t.repos.sessions.delete(sessionIdOf(token));
    t.hub.heartbeat();

    expect((await client.closing()).code).toBe(4401);
    await expectPong(survivor);
  });
});

describe("message size", () => {
  it("takes a message of exactly 64 KiB, and closes with 1009 on one byte more", async () => {
    const { url, token } = await served();
    const client = await TestClient.connect(url, { token });
    await client.next();
    // Valid JSON, padded to the size: a string of spaces is still invalid
    // as a message, so the answer is an error, but the socket stays open.
    const message = (size: number) => `"${" ".repeat(size - 2)}"`;

    client.send(message(65_536));
    expect(await client.next()).toMatchObject({
      type: "error",
      code: "invalid_message",
    });
    client.send(message(65_537));

    expect((await client.closing()).code).toBe(1009);
  });
});

describe("backpressure over a real socket", () => {
  it(
    "drops telemetry to a client that stops reading, keeps the rest, and resyncs when it reads again",
    { timeout: 30_000 },
    async () => {
      const highWaterBytes = 64 * 1024;
      const { t, url, token } = await served({ hub: { highWaterBytes } });
      const printerId = await t.addPrinter(token);
      const client = await TestClient.connect(url, { token });
      const topic = { name: "printer", printerId } as const;
      client.send({ type: "subscribe", topic });
      await client.nextMatching((m) => m.type === "snapshot");

      // Stop reading: the OS buffers fill, then the server's.
      client.socket.pause();
      let published = 0;
      const fellBehind = () =>
        jsonLines(t.logs).some((line) =>
          String(line.msg).startsWith("A WebSocket fell behind"),
        );
      // Bounded: well past what any OS buffers before the server's count grows.
      while (!fellBehind() && published < 200_000) {
        t.bus.publish(telemetry(printerId, published % 500));
        published += 1;
        if (published % 200 === 0) await settle();
      }
      expect(fellBehind()).toBe(true);
      t.bus.publish(telemetry(printerId, 777));
      t.bus.publish(status(printerId, "busy"));
      const lastSeq = t.store.seq;

      client.socket.resume();
      const resync = await client.nextMatching(
        (m) => m.type === "snapshot",
        20_000,
      );
      const received = client.messages.filter(
        (m): m is Extract<WsServerMessage, { type: "event" }> =>
          m.type === "event",
      );

      expect(resync).toMatchObject({ topic, seq: lastSeq });
      expect(resync).toMatchObject({
        data: { state: { status: "busy", telemetry: { speedPercent: 777 } } },
      });
      // Telemetry was dropped, but the status change was not.
      const telemetrySent = received.filter(
        (m) => m.event.type === "printer.telemetry",
      ).length;
      expect(telemetrySent).toBeLessThan(published + 1);
      expect(received.at(-1)?.event).toMatchObject({
        type: "printer.status_changed",
        seq: lastSeq,
      });
    },
  );
});
