// SPDX-FileCopyrightText: 2026 Open Print Stack contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

// The driver endpoint and the host's client together, through the cloning
// loopback: the path every driver call takes.

import { describe, expect, it } from "vitest";

import { fakeDriver, patchFakeDriver } from "./fake-driver.ts";
import {
  createLoopbackTransport,
  DriverClient,
  type DriverContext,
  type DriverMessage,
  type DriverModule,
  type DriverProtocolError,
  type LoopbackOptions,
  serveDriver,
} from "./index.ts";

const init = { printerId: "p1", settings: {}, storageDir: "/nowhere" };

function connectTo(
  module: DriverModule = fakeDriver,
  options: LoopbackOptions = {},
) {
  const transport = createLoopbackTransport(options);
  const messages: DriverMessage[] = [];
  const protocolErrors: DriverProtocolError[] = [];
  const emittedAfterDispose: DriverMessage[] = [];
  const client = new DriverClient(transport.host, {
    onMessage: (message) => messages.push(message),
    onProtocolError: (error) => protocolErrors.push(error),
  });
  const endpoint = serveDriver(module, init, transport.driver, {
    onEmitAfterDispose: (message) => emittedAfterDispose.push(message),
  });
  return {
    client,
    endpoint,
    messages,
    protocolErrors,
    emittedAfterDispose,
    transport,
  };
}

/** A module that hands its ctx to the test. */
function capturingCtx(): { module: DriverModule; ctx: () => DriverContext } {
  let captured: DriverContext | undefined;
  const module = patchFakeDriver((_driver, ctx) => {
    captured = ctx;
    return {};
  });
  return {
    module,
    ctx: () => {
      if (captured === undefined) {
        throw new Error("The driver wasn't created.");
      }
      return captured;
    },
  };
}

function flush(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

describe("serveDriver", () => {
  it("creates the driver with parsed settings, defaults applied", () => {
    let settings: unknown;
    const module = {
      ...fakeDriver,
      create: (...args: Parameters<typeof fakeDriver.create>) => {
        settings = args[0].settings;
        return fakeDriver.create(...args);
      },
    };

    connectTo(module);

    expect(settings).toEqual({
      tickMs: 20,
      cameraEnabled: true,
      reachable: true,
    });
  });

  it("throws if the settings don't match the schema", () => {
    const { driver } = createLoopbackTransport();

    expect(() =>
      serveDriver(fakeDriver, { ...init, settings: { tickMs: -1 } }, driver),
    ).toThrow(/tickMs/);
  });

  it("forwards what the driver emits, then answers", async () => {
    const { client, messages } = connectTo();

    await client.connect();

    expect(messages.map((message) => message.type)).toEqual([
      "capabilities",
      "status",
      "telemetry",
      "log",
    ]);
    expect(messages[3]).toEqual({
      type: "log",
      level: "info",
      message: "Connected.",
      data: { tickMs: 20 },
    });
    await client.dispose();
  });

  it("turns ctx.log calls into log messages", async () => {
    const { module, ctx } = capturingCtx();
    const { messages } = connectTo(module);

    ctx().log.debug("one");
    ctx().log.warn("two", { attempt: 2 });
    ctx().log.error("three");
    await flush();

    expect(messages).toEqual([
      { type: "log", level: "debug", message: "one" },
      { type: "log", level: "warn", message: "two", data: { attempt: 2 } },
      { type: "log", level: "error", message: "three" },
    ]);
  });

  describe("emitting something that isn't serialisable", () => {
    it.each([
      ["a Date", new Date(0), "message.message.detail is a Date"],
      ["a function", () => "idle", "message.message.detail is a function"],
    ])("throws from ctx.emit for %s", (_name, detail, problem) => {
      const { module, ctx } = capturingCtx();
      connectTo(module);

      expect(() =>
        ctx().emit({
          type: "status",
          status: "idle",
          detail: detail as unknown as string,
          error: null,
        }),
      ).toThrow(new TypeError(`Not serialisable: ${problem}.`));
    });

    it("fails the call that emitted it, as internal", async () => {
      const module = patchFakeDriver((_driver, ctx) => ({
        connect: () => {
          ctx.emit({
            type: "status",
            status: "idle",
            detail: new Date(0) as unknown as string,
            error: null,
          });
          return Promise.resolve();
        },
      }));
      const { client, messages } = connectTo(module);

      await expect(client.connect()).rejects.toMatchObject({
        code: "internal",
        message: "Not serialisable: message.message.detail is a Date.",
      });
      expect(messages).toEqual([]);
    });

    it("is still caught by the host's parse when cloning is off", async () => {
      const { module, ctx } = capturingCtx();
      const { messages, protocolErrors } = connectTo(module, { clone: false });

      ctx().emit({
        type: "status",
        status: "idle",
        detail: new Date(0) as unknown as string,
        error: null,
      });
      await flush();

      expect(messages).toEqual([]);
      expect(protocolErrors).toHaveLength(1);
      expect(protocolErrors[0]?.message).toMatch(/invalid message.*detail/s);
    });
  });

  it("answers a result that can't be sent with internal", async () => {
    const module = patchFakeDriver(() => ({
      listFiles: () =>
        Promise.resolve({
          files: [
            {
              name: "a.gcode",
              sizeBytes: 1,
              modifiedAt: new Date(0) as unknown as string,
            },
          ],
        }),
    }));
    const { client } = connectTo(module);

    await expect(client.listFiles()).rejects.toMatchObject({
      code: "internal",
      message:
        "The driver's result for \"listFiles\" can't be sent. Not serialisable: message.result.files[0].modifiedAt is a Date.",
    });
  });

  it("answers an unknown op with not_supported", async () => {
    const { client } = connectTo();

    await expect(
      client.call({ op: "explode", args: {} } as never),
    ).rejects.toMatchObject({
      code: "not_supported",
      message: 'Unknown op "explode".',
    });
  });

  it("logs a malformed request instead of answering it", async () => {
    const { transport, messages, protocolErrors } = connectTo();

    transport.host.send({ type: "request", op: "pause" } as never);
    await flush();

    expect(messages).toEqual([
      expect.objectContaining({
        type: "log",
        level: "error",
        message: "Ignored a malformed request from the host.",
      }),
    ]);
    expect(protocolErrors).toEqual([]);
  });

  describe("after dispose", () => {
    it("fails every request as internal", async () => {
      const { client } = connectTo();
      await client.dispose();

      await expect(client.connect()).rejects.toMatchObject({
        code: "internal",
        message: "The driver was disposed.",
      });
    });

    it("drops what the driver emits, and reports it", async () => {
      const { module, ctx } = capturingCtx();
      const { client, messages, emittedAfterDispose } = connectTo(module);
      await client.dispose();

      ctx().log.info("Still here.");
      await flush();

      expect(messages).toEqual([]);
      expect(emittedAfterDispose).toEqual([
        { type: "log", level: "info", message: "Still here." },
      ]);
    });
  });
});
