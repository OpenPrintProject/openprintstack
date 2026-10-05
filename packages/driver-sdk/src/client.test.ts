// SPDX-FileCopyrightText: 2026 Open Print Stack contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

// The host's client against a scripted driver end, which can answer anything,
// including things a real endpoint never sends.

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createLoopbackTransport,
  DriverClient,
  DriverError,
  type DriverMessage,
  type DriverProtocolError,
  type DriverToHostMessage,
} from "./index.ts";

interface Received {
  id: number;
  op: string;
  args: unknown;
}

function scripted(timeoutMs?: number) {
  // Cloning stays off so the script can send invalid messages.
  const transport = createLoopbackTransport({ clone: false });
  const requests: Received[] = [];
  transport.driver.onMessage((raw) => requests.push(raw as Received));
  const messages: DriverMessage[] = [];
  const protocolErrors: DriverProtocolError[] = [];
  const client = new DriverClient(transport.host, {
    onMessage: (message) => messages.push(message),
    onProtocolError: (error) => protocolErrors.push(error),
    timeoutMs,
  });
  return {
    client,
    requests,
    messages,
    protocolErrors,
    transport,
    /** Sends anything to the client as if the driver had. */
    send: (message: unknown) =>
      transport.driver.send(message as DriverToHostMessage),
  };
}

function flush(): Promise<void> {
  return Promise.resolve().then(() => undefined);
}

describe("DriverClient", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("sends a request per call and resolves with the parsed result", async () => {
    const { client, requests, send } = scripted();
    const files = client.listFiles();
    await flush();

    expect(requests).toEqual([
      { type: "request", id: 1, op: "listFiles", args: {} },
    ]);
    const result = {
      files: [{ name: "a", sizeBytes: null, modifiedAt: null }],
    };
    send({ type: "response", id: 1, ok: true, result });

    await expect(files).resolves.toEqual(result);
  });

  it("resolves an op that returns nothing with undefined", async () => {
    const { client, send } = scripted();
    const fan = client.setFan({ fanId: "part", percent: 50 });

    send({ type: "response", id: 1, ok: true, result: null });

    await expect(fan).resolves.toBeUndefined();
  });

  it("keeps a snapshot's bytes", async () => {
    const { client, send } = scripted();
    const snapshot = client.getSnapshot({ cameraId: "main" });

    send({
      type: "response",
      id: 1,
      ok: true,
      result: { mimeType: "image/png", data: new Uint8Array([1, 2]) },
    });

    expect((await snapshot).data).toEqual(new Uint8Array([1, 2]));
  });

  it("throws an error response as an equal DriverError", async () => {
    const { client, send } = scripted();
    const pause = client.pause();

    send({
      type: "response",
      id: 1,
      ok: false,
      error: { code: "invalid_state", message: "Not printing." },
    });

    const error: unknown = await pause.catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(DriverError);
    expect(error).toMatchObject({
      code: "invalid_state",
      message: "Not printing.",
    });
  });

  it("passes on valid messages and reports invalid ones", async () => {
    const { messages, protocolErrors, send } = scripted();

    send({ type: "message", message: { type: "files_changed" } });
    send({ type: "message", message: { type: "status", status: "exploded" } });
    send("nonsense");
    await flush();

    expect(messages).toEqual([{ type: "files_changed" }]);
    expect(protocolErrors.map((error) => error.received)).toEqual([
      { type: "message", message: { type: "status", status: "exploded" } },
      "nonsense",
    ]);
  });

  it.each(["text/html", "image/svg+xml", "image/"])(
    "rejects a snapshot of type %s",
    async (mimeType) => {
      const { client, send } = scripted();
      const snapshot = client.getSnapshot({ cameraId: "main" });

      send({
        type: "response",
        id: 1,
        ok: true,
        result: { mimeType, data: new Uint8Array([1]) },
      });

      await expect(snapshot).rejects.toMatchObject({ code: "internal" });
    },
  );

  it("rejects an invalid result as internal and reports it", async () => {
    const { client, protocolErrors, send } = scripted();
    const snapshot = client.getSnapshot({ cameraId: "main" });

    send({
      type: "response",
      id: 1,
      ok: true,
      result: { mimeType: "text/html", data: new Uint8Array([1]) },
    });

    await expect(snapshot).rejects.toMatchObject({
      code: "internal",
      message: 'The driver returned an invalid result for "getSnapshot".',
    });
    expect(protocolErrors).toHaveLength(1);
  });

  it("fails a call straight away when its response is malformed", async () => {
    const { client, protocolErrors, send } = scripted();
    const pause = client.pause();

    send({ type: "response", id: 1, ok: false, error: { code: "exploded" } });

    await expect(pause).rejects.toMatchObject({
      code: "internal",
      message: "The driver sent an invalid response.",
    });
    expect(protocolErrors).toHaveLength(1);
  });

  it("reports an answer to a request it never sent", async () => {
    const { protocolErrors, send } = scripted();

    send({ type: "response", id: 99, ok: true, result: null });
    await flush();

    expect(protocolErrors.map((error) => error.message)).toEqual([
      "The driver answered request 99, which isn't pending.",
    ]);
  });

  describe("timeouts", () => {
    it("fails a call that isn't answered in time", async () => {
      vi.useFakeTimers();
      const { client } = scripted(1000);
      const pause = client.pause();

      vi.advanceTimersByTime(1000);

      await expect(pause).rejects.toMatchObject({
        code: "timeout",
        message: 'The driver didn\'t answer "pause" within 1000 ms.',
      });
    });

    it("lets one call set its own timeout", async () => {
      vi.useFakeTimers();
      const { client, send } = scripted(1000);
      const upload = client.call(
        {
          op: "sendFile",
          args: { fileName: "a.gcode", sizeBytes: 1, path: "/staging/a" },
        },
        { timeoutMs: 600_000 },
      );

      vi.advanceTimersByTime(599_999);
      send({ type: "response", id: 1, ok: true, result: null });

      await expect(upload).resolves.toBeUndefined();
    });

    it("drops a late answer quietly", async () => {
      vi.useFakeTimers();
      const { client, protocolErrors, send } = scripted(1000);
      const pause = client.pause().catch(() => undefined);
      vi.advanceTimersByTime(1000);
      await pause;

      send({ type: "response", id: 1, ok: true, result: null });
      await flush();

      expect(protocolErrors).toEqual([]);
    });
  });

  it("rejects calls it can't send", async () => {
    const transport = createLoopbackTransport();
    const client = new DriverClient(transport.host, {
      onMessage: () => undefined,
      onProtocolError: () => undefined,
    });

    await expect(
      client.invokeExtension({
        extension: "simulator",
        action: "x",
        params: { at: new Date(0) } as never,
      }),
    ).rejects.toMatchObject({
      code: "internal",
      message:
        'Couldn\'t send "invokeExtension". Not serialisable: message.args.params.at is a Date.',
    });
  });

  it("fails pending and later calls once closed", async () => {
    const { client } = scripted();
    const pause = client.pause();

    client.close();

    await expect(pause).rejects.toMatchObject({
      code: "internal",
      message: "The driver connection closed.",
    });
    await expect(client.resume()).rejects.toMatchObject({
      code: "internal",
      message: "The driver connection is closed.",
    });
  });
});
