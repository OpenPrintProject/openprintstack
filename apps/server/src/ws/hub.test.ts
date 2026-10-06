// SPDX-FileCopyrightText: 2026 Open Print Stack contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import type {
  PrinterStatus,
  Topic,
  WsServerMessage,
} from "@openprintstack/protocol";
import {
  PRINTER_ID,
  telemetryFixture,
} from "@openprintstack/protocol/fixtures";
import { describe, expect, it, onTestFinished, vi } from "vitest";

import type { SessionEndedListener } from "../auth/sessions.ts";
import { type EventDraft, EventBus } from "../bus/bus.ts";
import { StateStore } from "../state/store.ts";
import { debugLogger, jsonLines } from "../test-utils.ts";
import {
  type HubConnection,
  type HubSocket,
  WS_CLOSE,
  WsHub,
  type WsHubOptions,
} from "./hub.ts";

const OTHER = "printer-2";
const MiB = 1024 * 1024;
const driver = { kind: "driver" } as const;
const user = { id: "user-1", username: "rob" };

/** A socket whose buffered bytes and completed sends the test controls. */
class FakeSocket implements HubSocket {
  bufferedAmount = 0;
  /** Every message sent, parsed. */
  readonly sent: WsServerMessage[] = [];
  closedWith: { code: number; reason: string } | undefined;
  pings = 0;
  terminated = false;
  /** Whether close() reports the socket closed, as the far end answering would. */
  closesWhenAsked = true;
  handle: HubConnection | undefined;
  #callbacks: ((error?: Error | null) => void)[] = [];
  #pong: (() => void) | undefined;

  send(data: string, callback: (error?: Error | null) => void): void {
    this.sent.push(JSON.parse(data) as WsServerMessage);
    this.#callbacks.push(callback);
  }

  /** Completes every send so far, leaving `bufferedAfter` bytes waiting. */
  flush(bufferedAfter = 0, error?: Error): void {
    this.complete(this.#callbacks.length, bufferedAfter, error);
  }

  /**
   * Completes the oldest `count` sends, leaving `bufferedAfter` bytes waiting.
   * A success passes null, as Node's streams do.
   */
  complete(count: number, bufferedAfter: number, error?: Error): void {
    this.bufferedAmount = bufferedAfter;
    for (const callback of this.#callbacks.splice(0, count)) {
      callback(error ?? null);
    }
  }

  close(code: number, reason: string): void {
    this.closedWith = { code, reason };
    if (this.closesWhenAsked) {
      queueMicrotask(() => this.handle?.closed(code));
    }
  }

  ping(): void {
    this.pings += 1;
  }

  terminate(): void {
    this.terminated = true;
    queueMicrotask(() => this.handle?.closed(1006));
  }

  on(_event: "pong", listener: () => void): this {
    this.#pong = listener;
    return this;
  }

  pong(): void {
    this.#pong?.();
  }

  /** Messages of one type. */
  ofType<T extends WsServerMessage["type"]>(type: T) {
    return this.sent.filter(
      (message): message is Extract<WsServerMessage, { type: T }> =>
        message.type === type,
    );
  }

  /** What arrived, as short labels: "snapshot fleet@3", "event printer printer.alert". */
  labels(): string[] {
    return this.sent.map((message) => {
      switch (message.type) {
        case "snapshot":
          return `snapshot ${message.topic.name}@${message.seq}`;
        case "event":
          return `event ${message.topic.name} ${message.event.type}`;
        case "error":
          return `error ${message.code}`;
        default:
          return message.type;
      }
    });
  }
}

function status(to: PrinterStatus, printerId = PRINTER_ID): EventDraft {
  return {
    type: "printer.status_changed",
    printerId,
    source: driver,
    payload: { previous: null, status: to, detail: null, error: null },
  };
}

function telemetry(printerId = PRINTER_ID): EventDraft {
  return {
    type: "printer.telemetry",
    printerId,
    source: driver,
    payload: { telemetry: structuredClone(telemetryFixture) },
  };
}

function alert(code: string, printerId = PRINTER_ID): EventDraft {
  return {
    type: "printer.alert",
    printerId,
    source: driver,
    payload: { severity: "info", code, message: "" },
  };
}

const removed: EventDraft = {
  type: "printer.removed",
  printerId: PRINTER_ID,
  source: { kind: "user", userId: user.id },
  payload: { name: "Sim 1" },
};

const logout: EventDraft = {
  type: "auth.logout",
  printerId: null,
  source: { kind: "user", userId: user.id },
  payload: {},
};

type Options = Partial<Omit<WsHubOptions, "bus" | "sessions" | "logger">>;

async function setup(options: Options = {}) {
  const { logger, output } = await debugLogger();
  const known = new Map([
    [PRINTER_ID, { name: "Sim 1", driverType: "simulated" }],
    [OTHER, { name: "Sim 2", driverType: "simulated" }],
  ]);
  const store = new StateStore({
    lookupPrinter: (id) => known.get(id),
    logger,
  });
  const bus = new EventBus({ store, logger });
  const active = new Set(["session-a", "session-b"]);
  const listeners = new Set<SessionEndedListener>();
  const isActive = vi.fn((sessionId: string) => active.has(sessionId));
  const sessions = {
    isActive,
    onSessionEnded: (listener: SessionEndedListener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
  const hub = new WsHub({ bus, store, sessions, logger, ...options });
  onTestFinished(async () => {
    await hub.close();
  });
  // Both printers exist before any socket opens.
  bus.publish(status("idle", PRINTER_ID));
  bus.publish(status("idle", OTHER));

  /** Opens a fake socket on the session, as the route would. */
  function open(sessionId = "session-a"): FakeSocket {
    const socket = new FakeSocket();
    socket.handle = hub.open(socket, { user, sessionId });
    return socket;
  }

  function send(socket: FakeSocket, message: unknown): void {
    socket.handle?.receive(JSON.stringify(message));
  }

  function subscribe(socket: FakeSocket, topic: Topic): void {
    send(socket, { type: "subscribe", topic });
  }

  return {
    hub,
    bus,
    store,
    logs: output,
    open,
    send,
    subscribe,
    isActive,
    listenerCount: () => listeners.size,
    /** Ends the session as the session service would: the listeners hear. */
    endSession(sessionId: string) {
      active.delete(sessionId);
      for (const listener of listeners) listener(sessionId);
    },
    /** Ends the session without telling anyone, as the pruner or the clock would. */
    expireSession(sessionId: string) {
      active.delete(sessionId);
    },
  };
}

/** Lets queued microtasks run, e.g. a fake socket reporting itself closed. */
async function microtasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

describe("opening a socket", () => {
  it("sends hello with the boot id and the user", async () => {
    const t = await setup();

    const socket = t.open();

    expect(socket.sent).toEqual([
      { type: "hello", bootId: t.bus.bootId, user },
    ]);
    expect(socket.closedWith).toBeUndefined();
    expect(t.hub.size).toBe(1);
  });

  it("closes with 4401, and sends nothing, if the session ended before the socket opened", async () => {
    const t = await setup();
    t.expireSession("session-a");

    const socket = t.open("session-a");

    expect(socket.sent).toEqual([]);
    expect(socket.closedWith).toEqual({
      code: 4401,
      reason: "The session has ended.",
    });
    t.bus.publish(alert("after"));
    expect(socket.sent).toEqual([]);
  });

  it("forgets a socket once it has closed", async () => {
    const t = await setup();
    const socket = t.open();

    socket.handle?.closed(1000);

    expect(t.hub.size).toBe(0);
  });
});

describe("subscribing", () => {
  it("answers fleet with every printer's snapshot, then sends each later event about any printer", async () => {
    const t = await setup();
    const socket = t.open();

    t.subscribe(socket, { name: "fleet" });
    const atSubscribe = t.store.list();
    t.bus.publish(alert("one", PRINTER_ID));
    t.bus.publish(alert("two", OTHER));
    t.bus.publish(logout);

    const [snapshot] = socket.ofType("snapshot");
    expect(snapshot).toEqual({
      type: "snapshot",
      topic: { name: "fleet" },
      seq: 2,
      data: atSubscribe,
    });
    expect(snapshot?.data).toHaveLength(2);
    expect(socket.labels()).toEqual([
      "hello",
      "snapshot fleet@2",
      "event fleet printer.alert",
      "event fleet printer.alert",
    ]);
    expect(socket.ofType("event").map((m) => m.event.seq)).toEqual([3, 4]);
  });

  it("reads the snapshot and registers the topic in the same step: an event published at once follows it", async () => {
    const t = await setup();
    const socket = t.open();

    // Published in the same tick as the subscribe, straight after it.
    t.subscribe(socket, { name: "printer", printerId: PRINTER_ID });
    t.bus.publish(status("busy"));

    const [snapshot] = socket.ofType("snapshot");
    const [event] = socket.ofType("event");
    expect(snapshot?.seq).toBe(2);
    expect(snapshot?.data).toMatchObject({ state: { status: "idle" } });
    expect(event?.event).toMatchObject({
      seq: 3,
      payload: { status: "busy" },
    });
    expect(socket.labels()).toEqual([
      "hello",
      "snapshot printer@2",
      "event printer printer.status_changed",
    ]);
  });

  it("never sends an event from before the subscribe", async () => {
    const t = await setup();
    const socket = t.open();

    t.bus.publish(alert("before"));
    t.subscribe(socket, { name: "fleet" });
    t.bus.publish(alert("after"));

    const events = socket.ofType("event").map((m) => m.event);
    expect(events).toMatchObject([{ payload: { code: "after" } }]);
    expect(socket.ofType("snapshot")[0]?.seq).toBe(3);
  });

  it("gives a printer topic its printer's snapshot and only that printer's events", async () => {
    const t = await setup();
    const socket = t.open();
    const topic = { name: "printer", printerId: PRINTER_ID } as const;

    t.subscribe(socket, topic);
    const atSubscribe = t.store.get(PRINTER_ID);
    t.bus.publish(alert("mine", PRINTER_ID));
    t.bus.publish(alert("theirs", OTHER));

    expect(socket.ofType("snapshot")).toEqual([
      { type: "snapshot", topic, seq: 2, data: atSubscribe },
    ]);
    expect(socket.ofType("event")).toMatchObject([
      { topic, event: { payload: { code: "mine" } } },
    ]);
  });

  it("refuses a printer that doesn't exist with printer_not_found, naming the topic", async () => {
    const t = await setup();
    const socket = t.open();
    const topic = { name: "printer", printerId: "nope" } as const;

    t.subscribe(socket, topic);
    t.bus.publish(alert("later", "nope"));

    expect(socket.sent.slice(1)).toEqual([
      {
        type: "error",
        code: "printer_not_found",
        message: "There is no printer nope.",
        topic,
      },
    ]);
  });

  it("gives the events topic a snapshot that only marks the seq, then its matching events", async () => {
    const t = await setup();
    const socket = t.open();
    const topic = { name: "events" } as const;

    t.subscribe(socket, topic);
    t.bus.publish(telemetry());
    t.bus.publish(alert("one"));
    t.bus.publish(logout);

    expect(socket.ofType("snapshot")).toEqual([
      { type: "snapshot", topic, seq: 2, data: null },
    ]);
    expect(socket.labels().slice(2)).toEqual([
      "event events printer.alert",
      "event events auth.logout",
    ]);
  });

  it("applies the events topic's filters", async () => {
    const t = await setup();
    const socket = t.open();
    const topic: Topic = {
      name: "events",
      printerId: PRINTER_ID,
      types: ["printer.telemetry", "printer.alert"],
    };

    t.subscribe(socket, topic);
    t.bus.publish(telemetry(PRINTER_ID));
    t.bus.publish(telemetry(OTHER));
    t.bus.publish(status("busy"));
    t.bus.publish(alert("one", OTHER));
    t.bus.publish(alert("two", PRINTER_ID));
    t.bus.publish(logout);

    expect(socket.ofType("event").map((m) => m.event.seq)).toEqual([3, 7]);
  });

  it("sends an event once for each topic it matches, each naming its topic", async () => {
    const t = await setup();
    const socket = t.open();
    const printer = { name: "printer", printerId: PRINTER_ID } as const;

    t.subscribe(socket, { name: "fleet" });
    t.subscribe(socket, printer);
    t.subscribe(socket, { name: "events" });
    t.bus.publish(alert("one"));

    expect(socket.ofType("event")).toMatchObject([
      { topic: { name: "fleet" }, event: { seq: 3 } },
      { topic: printer, event: { seq: 3 } },
      { topic: { name: "events" }, event: { seq: 3 } },
    ]);
  });

  it("answers a repeated subscribe with a fresh snapshot, and keeps one subscription", async () => {
    const t = await setup();
    const socket = t.open();

    t.subscribe(socket, { name: "fleet" });
    t.bus.publish(alert("one"));
    t.subscribe(socket, { name: "fleet" });
    t.bus.publish(alert("two"));

    expect(socket.labels()).toEqual([
      "hello",
      "snapshot fleet@2",
      "event fleet printer.alert",
      "snapshot fleet@3",
      "event fleet printer.alert",
    ]);
  });

  it("treats events topics with the same filters as one subscription, answering in the latest form", async () => {
    const t = await setup();
    const socket = t.open();

    t.subscribe(socket, {
      name: "events",
      types: ["printer.alert", "auth.logout"],
    });
    const latest: Topic = {
      name: "events",
      types: ["auth.logout", "printer.alert", "auth.logout"],
      includeTelemetry: false,
    };
    t.subscribe(socket, latest);
    t.bus.publish(alert("one"));

    expect(socket.ofType("event")).toEqual([
      expect.objectContaining({ topic: latest }) as unknown,
    ]);
  });

  it("stops sending a topic's events after unsubscribe, and ignores unsubscribing from what it doesn't have", async () => {
    const t = await setup();
    const socket = t.open();

    t.subscribe(socket, { name: "fleet" });
    t.send(socket, { type: "unsubscribe", topic: { name: "fleet" } });
    t.send(socket, { type: "unsubscribe", topic: { name: "events" } });
    t.bus.publish(alert("one"));

    expect(socket.labels()).toEqual(["hello", "snapshot fleet@2"]);
  });

  it("drops a printer topic after delivering printer.removed", async () => {
    const t = await setup();
    const socket = t.open();
    const printer = { name: "printer", printerId: PRINTER_ID } as const;
    t.subscribe(socket, printer);
    t.subscribe(socket, { name: "fleet" });

    t.bus.publish(removed);
    // Nothing more can be published for a removed printer, except by a bug;
    // the bus still delivers it, and fleet still matches it.
    t.bus.publish(alert("ghost"));

    expect(socket.labels().slice(3)).toEqual([
      "event printer printer.removed",
      "event fleet printer.removed",
      "event fleet printer.alert",
    ]);
  });

  it("refuses a 101st topic with too_many_topics, but still takes repeats and room made by unsubscribing", async () => {
    const t = await setup();
    const socket = t.open();
    const topics = Array.from({ length: 100 }, (_, i): Topic => ({
      name: "events",
      printerId: `p-${i}`,
    }));
    for (const topic of topics) t.subscribe(socket, topic);
    const extra: Topic = { name: "events", printerId: "p-100" };

    t.subscribe(socket, extra);
    t.subscribe(socket, topics[0]!);
    t.send(socket, { type: "unsubscribe", topic: topics[1] });
    t.subscribe(socket, extra);

    expect(socket.labels().slice(101)).toEqual([
      "error too_many_topics",
      "snapshot events@2",
      "snapshot events@2",
    ]);
    expect(socket.sent[101]).toEqual({
      type: "error",
      code: "too_many_topics",
      message:
        "A connection can have at most 100 topics. Unsubscribe from one first.",
      topic: extra,
    });
  });

  it("takes another limit on topics", async () => {
    const t = await setup({ maxTopics: 1 });
    const socket = t.open();

    t.subscribe(socket, { name: "fleet" });
    t.subscribe(socket, { name: "events" });

    expect(socket.labels()).toEqual([
      "hello",
      "snapshot fleet@2",
      "error too_many_topics",
    ]);
  });
});

describe("other messages", () => {
  it("answers ping with pong", async () => {
    const t = await setup();
    const socket = t.open();

    t.send(socket, { type: "ping" });

    expect(socket.sent.at(-1)).toEqual({ type: "pong" });
  });

  it.each([
    ["binary", new ArrayBuffer(4), "Messages must be JSON text, not binary."],
    ["not JSON", "{nope", "The message isn't JSON."],
    [
      "an unknown type",
      JSON.stringify({ type: "shout" }),
      "The message isn't valid.",
    ],
    [
      "an unknown topic",
      JSON.stringify({ type: "subscribe", topic: { name: "everything" } }),
      "The message isn't valid.",
    ],
    [
      "a printer topic without a printer",
      JSON.stringify({ type: "subscribe", topic: { name: "printer" } }),
      "The message isn't valid.",
    ],
  ] as const)(
    "answers %s with invalid_message and keeps the socket open",
    async (_name, data, message) => {
      const t = await setup();
      const socket = t.open();

      socket.handle?.receive(data);
      t.send(socket, { type: "ping" });

      expect(socket.sent[1]).toMatchObject({
        type: "error",
        code: "invalid_message",
      });
      const error = socket.sent[1] as { message: string; topic?: unknown };
      expect(error.message.startsWith(message)).toBe(true);
      expect(error).not.toHaveProperty("topic");
      expect(socket.sent[2]).toEqual({ type: "pong" });
      expect(socket.closedWith).toBeUndefined();
    },
  );

  it("includes Zod's summary of what's wrong", async () => {
    const t = await setup();
    const socket = t.open();

    t.send(socket, { type: "subscribe", topic: { name: "printer" } });

    expect((socket.sent[1] as { message: string }).message).toContain("✖");
  });
});

describe("backpressure", () => {
  async function behind() {
    const t = await setup();
    const socket = t.open();
    const printer = { name: "printer", printerId: PRINTER_ID } as const;
    t.subscribe(socket, { name: "fleet" });
    t.subscribe(socket, printer);
    t.subscribe(socket, { name: "events" });
    t.subscribe(socket, {
      name: "events",
      printerId: OTHER,
      includeTelemetry: true,
    });
    socket.sent.length = 0;
    return { t, socket, printer };
  }

  it("keeps sending telemetry with exactly 1 MiB waiting", async () => {
    const { t, socket } = await behind();
    socket.bufferedAmount = MiB;

    t.bus.publish(telemetry());

    expect(socket.labels()).toEqual([
      "event fleet printer.telemetry",
      "event printer printer.telemetry",
    ]);
  });

  it("drops telemetry over 1 MiB but still sends every other event", async () => {
    const { t, socket } = await behind();
    socket.bufferedAmount = MiB + 1;

    t.bus.publish(telemetry(PRINTER_ID));
    t.bus.publish(status("busy"));
    t.bus.publish(telemetry(OTHER));
    t.bus.publish(logout);

    expect(socket.labels()).toEqual([
      "event fleet printer.status_changed",
      "event printer printer.status_changed",
      "event events printer.status_changed",
      "event events auth.logout",
    ]);
  });

  it("resyncs, once under 1 MiB, exactly the topics that lost telemetry", async () => {
    const { t, socket, printer } = await behind();
    socket.bufferedAmount = MiB + 1;
    t.bus.publish(telemetry(PRINTER_ID));
    t.bus.publish(status("busy"));

    // Three sends are waiting: the status event on three topics.
    socket.complete(2, MiB);
    expect(socket.ofType("snapshot")).toEqual([]);

    socket.complete(1, MiB - 1);
    const snapshots = socket.ofType("snapshot");
    expect(snapshots).toEqual([
      {
        type: "snapshot",
        topic: { name: "fleet" },
        seq: 4,
        data: t.store.list(),
      },
      {
        type: "snapshot",
        topic: printer,
        seq: 4,
        data: t.store.get(PRINTER_ID),
      },
    ]);
    // The resync carries the telemetry that was dropped.
    expect(snapshots[1]?.data).toMatchObject({
      state: { telemetry: telemetryFixture, status: "busy" },
    });
  });

  it("resyncs an events topic that lost telemetry, with a snapshot marking the seq", async () => {
    const { t, socket } = await behind();
    socket.bufferedAmount = MiB + 1;
    t.bus.publish(telemetry(OTHER));

    socket.flush(0);

    expect(socket.labels()).toEqual(["snapshot fleet@3", "snapshot events@3"]);
    expect(socket.sent[1]).toMatchObject({
      topic: { name: "events", printerId: OTHER, includeTelemetry: true },
      data: null,
    });
  });

  it("resyncs only once, and sends telemetry again afterwards", async () => {
    const { t, socket } = await behind();
    socket.bufferedAmount = MiB + 1;
    t.bus.publish(telemetry());
    socket.flush(0);
    socket.sent.length = 0;

    socket.flush(0);
    t.bus.publish(telemetry());

    expect(socket.labels()).toEqual([
      "event fleet printer.telemetry",
      "event printer printer.telemetry",
    ]);
  });

  it("doesn't resync when nothing was dropped", async () => {
    const { t, socket } = await behind();
    socket.bufferedAmount = MiB + 1;
    t.bus.publish(status("busy"));

    socket.flush(0);

    expect(socket.ofType("snapshot")).toEqual([]);
  });

  it("doesn't resync on a failed send", async () => {
    const { t, socket } = await behind();
    socket.bufferedAmount = MiB + 1;
    t.bus.publish(telemetry());
    t.bus.publish(status("busy"));

    socket.flush(0, new Error("The socket broke."));

    expect(socket.ofType("snapshot")).toEqual([]);
  });

  it("drops telemetry only for the socket that's behind", async () => {
    const t = await setup();
    const slow = t.open();
    const fast = t.open("session-b");
    t.subscribe(slow, { name: "fleet" });
    t.subscribe(fast, { name: "fleet" });
    slow.bufferedAmount = MiB + 1;

    t.bus.publish(telemetry());

    expect(slow.ofType("event")).toEqual([]);
    expect(fast.ofType("event")).toHaveLength(1);
  });

  it("closes a socket with more than 16 MiB waiting with 4008, and sends it nothing more", async () => {
    const t = await setup();
    const socket = t.open();
    t.subscribe(socket, { name: "fleet" });
    socket.bufferedAmount = 16 * MiB;
    t.bus.publish(status("busy"));
    expect(socket.closedWith).toBeUndefined();

    socket.bufferedAmount = 16 * MiB + 1;
    t.bus.publish(status("idle"));
    t.bus.publish(status("busy"));
    t.send(socket, { type: "ping" });

    expect(socket.closedWith).toEqual({
      code: 4008,
      reason: "The connection fell too far behind.",
    });
    expect(socket.labels().slice(2)).toEqual([
      "event fleet printer.status_changed",
      "event fleet printer.status_changed",
    ]);
  });

  it("takes other thresholds", async () => {
    const t = await setup({ highWaterBytes: 10, maxBufferedBytes: 20 });
    const socket = t.open();
    t.subscribe(socket, { name: "fleet" });
    socket.bufferedAmount = 11;

    t.bus.publish(telemetry());
    expect(socket.ofType("event")).toEqual([]);

    socket.bufferedAmount = 21;
    t.bus.publish(status("busy"));
    expect(socket.closedWith?.code).toBe(4008);
  });

  it("logs falling behind and catching up at debug", async () => {
    const { t, socket } = await behind();
    socket.bufferedAmount = MiB + 1;
    t.bus.publish(telemetry());
    t.bus.publish(telemetry());
    t.bus.publish(status("busy"));
    socket.flush(0);

    const lines = jsonLines(t.logs).filter((line) => line.component === "ws");
    expect(lines.map((line) => [line.level, line.msg])).toEqual([
      ["debug", "WebSocket opened"],
      [
        "debug",
        "A WebSocket fell behind; dropping its telemetry until it catches up",
      ],
      [
        "debug",
        "A WebSocket caught up; resyncing the topics that lost telemetry",
      ],
    ]);
    expect(lines[2]).toMatchObject({ topics: 2, userId: user.id });
  });
});

describe("keep-alive and sessions", () => {
  it("pings every 30 s, and cuts off a socket that didn't answer the last ping", async () => {
    vi.useFakeTimers({ toNotFake: ["queueMicrotask"] });
    onTestFinished(() => {
      vi.useRealTimers();
    });
    const t = await setup();
    const answers = t.open();
    const silent = t.open("session-b");

    vi.advanceTimersByTime(29_999);
    expect([answers.pings, silent.pings]).toEqual([0, 0]);
    vi.advanceTimersByTime(1);
    expect([answers.pings, silent.pings]).toEqual([1, 1]);

    answers.pong();
    vi.advanceTimersByTime(30_000);
    expect([answers.pings, silent.pings]).toEqual([2, 1]);
    expect([answers.terminated, silent.terminated]).toEqual([false, true]);

    answers.pong();
    vi.advanceTimersByTime(30_000);
    expect(answers.terminated).toBe(false);
    await microtasks();
    expect(t.hub.size).toBe(1);
  });

  it("closes, at the next round, sockets whose session expired or was deleted without a word", async () => {
    const t = await setup();
    const expired = t.open("session-a");
    const fine = t.open("session-b");

    t.expireSession("session-a");
    t.bus.publish(alert("before the round"));
    expect(expired.closedWith).toBeUndefined();
    t.hub.heartbeat();

    expect(expired.closedWith).toEqual({
      code: 4401,
      reason: "The session has ended.",
    });
    expect(expired.pings).toBe(0);
    expect(fine.closedWith).toBeUndefined();
    expect(fine.pings).toBe(1);
  });

  it("checks each session once a round", async () => {
    const t = await setup();
    t.open("session-a");
    t.open("session-a");
    t.open("session-b");
    t.isActive.mockClear();

    t.hub.heartbeat();

    expect(t.isActive.mock.calls).toEqual([["session-a"], ["session-b"]]);
  });

  it("closes the ended session's sockets with 4401 at once, and only those", async () => {
    const t = await setup();
    const first = t.open("session-a");
    const second = t.open("session-a");
    const other = t.open("session-b");
    for (const socket of [first, second, other]) {
      t.subscribe(socket, { name: "fleet" });
    }

    t.endSession("session-a");
    t.bus.publish(alert("after"));

    for (const socket of [first, second]) {
      expect(socket.closedWith).toEqual({
        code: 4401,
        reason: "The session has ended.",
      });
      expect(socket.ofType("event")).toEqual([]);
    }
    expect(other.closedWith).toBeUndefined();
    expect(other.ofType("event")).toHaveLength(1);
    await microtasks();
    expect(t.hub.size).toBe(1);
  });
});

describe("close", () => {
  it("closes every socket with 1001, then stops pinging, taking events and hearing about sessions", async () => {
    const t = await setup();
    const sockets = [t.open(), t.open("session-b")];
    t.subscribe(sockets[0]!, { name: "fleet" });

    await t.hub.close();
    t.bus.publish(alert("after"));
    t.hub.heartbeat();

    for (const socket of sockets) {
      expect(socket.closedWith).toEqual({
        code: 1001,
        reason: "The server is shutting down.",
      });
      expect(socket.ofType("event")).toEqual([]);
    }
    expect(t.hub.size).toBe(0);
    expect(t.listenerCount()).toBe(0);
  });

  it("closes a socket that opens afterwards with 1001", async () => {
    const t = await setup();
    await t.hub.close();

    const late = t.open();

    expect(late.sent).toEqual([]);
    expect(late.closedWith?.code).toBe(1001);
  });

  it("cuts off sockets that haven't finished closing after 2 s", async () => {
    vi.useFakeTimers({ toNotFake: ["queueMicrotask"] });
    onTestFinished(() => {
      vi.useRealTimers();
    });
    const t = await setup();
    const stuck = t.open();
    stuck.closesWhenAsked = false;
    let done = false;

    const closing = t.hub.close().then(() => {
      done = true;
    });
    await vi.advanceTimersByTimeAsync(1999);
    expect([stuck.terminated, done]).toEqual([false, false]);
    await vi.advanceTimersByTimeAsync(1);
    await closing;

    expect([stuck.terminated, done]).toEqual([true, true]);
  });

  it("returns the same promise when called again", async () => {
    const t = await setup();
    t.open();

    expect(t.hub.close()).toBe(t.hub.close());
    await t.hub.close();
  });
});

describe("checking messages", () => {
  async function broken(validate?: boolean) {
    const { logger, output } = await debugLogger();
    const bus = new EventBus({
      store: { apply: () => undefined },
      logger,
    });
    // A store with a bug: its snapshot isn't a PrinterSnapshot.
    const store = {
      seq: 0,
      list: () => [],
      get: () => ({ printer: "Sim 1" }) as never,
    };
    const sessions = {
      isActive: () => true,
      onSessionEnded: () => () => undefined,
    };
    const hub = new WsHub({
      bus,
      store,
      sessions,
      logger,
      ...(validate !== undefined && { validate }),
    });
    onTestFinished(async () => {
      await hub.close();
    });
    const socket = new FakeSocket();
    socket.handle = hub.open(socket, { user, sessionId: "s" });
    socket.handle.receive(
      JSON.stringify({
        type: "subscribe",
        topic: { name: "printer", printerId: PRINTER_ID },
      }),
    );
    return { socket, logs: output };
  }

  it("closes the socket with 1011 and logs the error when a message fails its check", async () => {
    const { socket, logs } = await broken();

    expect(socket.labels()).toEqual(["hello"]);
    expect(socket.closedWith).toEqual({
      code: 1011,
      reason: "Something went wrong on the server.",
    });
    expect(
      jsonLines(logs).find((line) => line.level === "error"),
    ).toMatchObject({
      component: "ws",
      messageType: "snapshot",
      msg: "A WebSocket message failed its check; closed the socket",
    });
  });

  it("sends messages unchecked when validate is off", async () => {
    const { socket } = await broken(false);

    expect(socket.sent[1]).toMatchObject({
      type: "snapshot",
      data: { printer: "Sim 1" },
    });
    expect(socket.closedWith).toBeUndefined();
  });
});

describe("close codes", () => {
  it("are the ones the plan and protocol give", () => {
    expect(WS_CLOSE).toEqual({
      goingAway: 1001,
      internalError: 1011,
      tooFarBehind: 4008,
      sessionEnded: 4401,
    });
  });
});
