// SPDX-FileCopyrightText: 2026 Open Print Stack contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { createSocket } from "node:dgram";

import { describe, expect, it, onTestFinished } from "vitest";

import { identifyPrinter } from "./identify.ts";
import { DISCOVERY_QUERY } from "./protocol.ts";
import {
  FAKE_MODEL,
  FAKE_NAME,
  FAKE_SERIAL,
  FakeCc2,
  type FakeCc2Options,
} from "./testing/index.ts";

async function fakePrinter(options?: FakeCc2Options): Promise<FakeCc2> {
  const fake = await FakeCc2.start(options);
  onTestFinished(() => fake.close());
  return fake;
}

/** A UDP server on loopback that answers each query with `replies`. */
async function replier(replies: string[]): Promise<number> {
  const socket = createSocket("udp4");
  await new Promise<void>((resolve) => socket.bind(0, "127.0.0.1", resolve));
  onTestFinished(() => new Promise<void>((resolve) => socket.close(resolve)));
  socket.on("message", (message, from) => {
    if (message.toString() !== DISCOVERY_QUERY) return;
    for (const reply of replies) {
      socket.send(reply, from.port, from.address);
    }
  });
  return socket.address().port;
}

const options = { timeoutMs: 1000, retryMs: 100 };

describe("identifyPrinter", () => {
  it("asks the printer for its serial number and settings", async () => {
    const fake = await fakePrinter();

    expect(await identifyPrinter(fake.host, fake.ports.udp, options)).toEqual({
      serial: FAKE_SERIAL,
      name: FAKE_NAME,
      model: FAKE_MODEL,
      lanOnly: true,
      accessCodeSet: true,
    });
  });

  it("reports LAN Only mode off and no access code", async () => {
    const fake = await fakePrinter({ lanOnly: false, accessCodeSet: false });

    expect(
      await identifyPrinter(fake.host, fake.ports.udp, options),
    ).toMatchObject({ lanOnly: false, accessCodeSet: false });
  });

  it("asks again until the printer answers", async () => {
    const fake = await fakePrinter();
    fake.answerUdp = false;
    setTimeout(() => {
      fake.answerUdp = true;
    }, 250);

    expect(
      await identifyPrinter(fake.host, fake.ports.udp, options),
    ).toMatchObject({ serial: FAKE_SERIAL });
  });

  it("gives up with null when nothing answers in time", async () => {
    const fake = await fakePrinter();
    fake.answerUdp = false;
    const started = Date.now();

    expect(
      await identifyPrinter(fake.host, fake.ports.udp, {
        timeoutMs: 300,
        retryMs: 100,
      }),
    ).toBeNull();
    expect(Date.now() - started).toBeGreaterThanOrEqual(250);
  });

  it("skips replies that aren't an answer, and leaves out what's missing", async () => {
    const port = await replier([
      "not json",
      JSON.stringify({ id: 0, result: { sn: "" } }),
      JSON.stringify({ id: 0, result: { sn: "SN2" } }),
    ]);

    expect(await identifyPrinter("127.0.0.1", port, options)).toEqual({
      serial: "SN2",
      name: null,
      model: null,
      lanOnly: null,
      accessCodeSet: null,
    });
  });

  it("stops when aborted", async () => {
    const fake = await fakePrinter();
    fake.answerUdp = false;
    const controller = new AbortController();
    setTimeout(() => controller.abort(new Error("Stopped.")), 50);

    await expect(
      identifyPrinter(fake.host, fake.ports.udp, {
        ...options,
        signal: controller.signal,
      }),
    ).rejects.toThrow("Stopped.");
  });

  it("gives up with null for a host name that doesn't resolve", async () => {
    expect(
      await identifyPrinter("no-such-printer.invalid", 52700, {
        timeoutMs: 300,
        retryMs: 100,
      }),
    ).toBeNull();
  });
});
