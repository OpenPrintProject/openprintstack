// SPDX-FileCopyrightText: 2026 Open Print Stack contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createLoopbackTransport,
  type DriverEmit,
  type DriverRequest,
} from "./index.ts";

const request: DriverRequest = {
  type: "request",
  id: 1,
  op: "setFan",
  args: { fanId: "part", percent: 50 },
};

function emit(detail: unknown): DriverEmit {
  return {
    type: "message",
    message: { type: "status", status: "idle", detail, error: null },
  } as DriverEmit;
}

/** Lets queued microtasks, and so loopback deliveries, run. */
function flush(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

describe("createLoopbackTransport", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("delivers each message to the other end later, in order", async () => {
    const { host, driver } = createLoopbackTransport();
    const received: unknown[] = [];
    driver.onMessage((message) => received.push(message));

    host.send(request);
    host.send({ ...request, id: 2 });
    expect(received).toEqual([]);
    await flush();

    expect(received).toEqual([request, { ...request, id: 2 }]);
  });

  it("delivers both ways", async () => {
    const { host, driver } = createLoopbackTransport();
    const received: unknown[] = [];
    host.onMessage((message) => received.push(message));

    driver.send(emit(null));
    await flush();

    expect(received).toEqual([emit(null)]);
  });

  it("copies the message when it is sent", async () => {
    const { host, driver } = createLoopbackTransport();
    const received: unknown[] = [];
    driver.onMessage((message) => received.push(message));
    const sent = structuredClone(request);

    host.send(sent);
    sent.args.percent = 0;
    await flush();

    expect(received[0]).toEqual(request);
    expect(received[0]).not.toBe(sent);
  });

  it.each([
    ["a Date", new Date(0), "message.message.detail is a Date"],
    ["a function", () => "idle", "message.message.detail is a function"],
    ["a Map", new Map(), "message.message.detail is a Map"],
  ])(
    "throws from send for %s and delivers nothing",
    async (_name, detail, problem) => {
      const { host, driver } = createLoopbackTransport();
      const received: unknown[] = [];
      host.onMessage((message) => received.push(message));

      expect(() => driver.send(emit(detail))).toThrow(
        new TypeError(`Not serialisable: ${problem}.`),
      );
      await flush();

      expect(received).toEqual([]);
    },
  );

  it("passes messages by reference, unchecked, when cloning is off", async () => {
    const { host, driver } = createLoopbackTransport({ clone: false });
    const received: unknown[] = [];
    host.onMessage((message) => received.push(message));
    const message = emit(new Date(0));

    driver.send(message);
    await flush();

    expect(received[0]).toBe(message);
  });

  it("drops queued and later messages once either end closes", async () => {
    const { host, driver } = createLoopbackTransport();
    const received: unknown[] = [];
    driver.onMessage((message) => received.push(message));

    host.send(request);
    driver.close();
    host.send(request);
    await flush();

    expect(received).toEqual([]);
  });

  it("stops calling a handler once it is removed", async () => {
    const { host, driver } = createLoopbackTransport();
    const received: unknown[] = [];
    const remove = driver.onMessage((message) => received.push(message));

    remove();
    host.send(request);
    await flush();

    expect(received).toEqual([]);
  });

  it("still delivers while Vitest's fake timers are on", async () => {
    vi.useFakeTimers();
    const { host, driver } = createLoopbackTransport();
    const received: unknown[] = [];
    driver.onMessage((message) => received.push(message));

    host.send(request);
    await Promise.resolve();

    expect(received).toEqual([request]);
  });
});
