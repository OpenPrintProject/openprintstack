// SPDX-FileCopyrightText: 2026 Open Print Stack contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { PrinterStatus } from "@openprintstack/protocol";
import type { z } from "zod";

import { DriverClient, DriverProtocolError } from "../client.ts";
import type {
  DriverModule,
  PrinterDriver,
  SettingsSchema,
} from "../contract.ts";
import { serveDriver } from "../endpoint.ts";
import type { DriverMessage } from "../messages.ts";
import { createLoopbackTransport } from "../transport.ts";

export interface DriverHarnessOptions<S extends SettingsSchema> {
  /** Settings as a user would enter them; the endpoint applies defaults. */
  settings: z.input<S>;
  /** The client's timeout for every call. Default: 5000 ms. */
  timeoutMs?: number;
}

/**
 * A driver running behind the cloning loopback, as the host would run it, for
 * tests. Every message crosses the transport, so a message that isn't
 * serialisable fails where it is emitted.
 */
export interface DriverHarness {
  /** Talks to the driver through the transport, as the host does. */
  readonly client: DriverClient;
  /** The driver object itself, which the host never sees. */
  readonly driver: PrinterDriver;
  /** A fresh temporary folder, deleted by `close`. */
  readonly storageDir: string;
  /** Every valid message the driver emitted, in order. */
  readonly messages: DriverMessage[];
  /** Everything the client couldn't accept. */
  readonly protocolErrors: DriverProtocolError[];
  /** Messages emitted after `dispose`, which the endpoint dropped. */
  readonly emittedAfterDispose: DriverMessage[];
  /** The statuses reported so far, in order. */
  statuses(): PrinterStatus[];
  /** Disposes the driver if needed, closes the transport, deletes storage. */
  close(): Promise<void>;
}

export async function createDriverHarness<S extends SettingsSchema>(
  module: DriverModule<S>,
  options: DriverHarnessOptions<S>,
): Promise<DriverHarness> {
  const storageDir = await mkdtemp(join(tmpdir(), "ops-driver-"));
  const messages: DriverMessage[] = [];
  const protocolErrors: DriverProtocolError[] = [];
  const emittedAfterDispose: DriverMessage[] = [];

  const transport = createLoopbackTransport({ clone: true });
  const client = new DriverClient(transport.host, {
    onMessage: (message) => messages.push(message),
    onProtocolError: (error) => protocolErrors.push(error),
    timeoutMs: options.timeoutMs ?? 5000,
  });

  let driver: PrinterDriver;
  try {
    ({ driver } = serveDriver(
      module,
      {
        printerId: "conformance-printer",
        settings: options.settings,
        storageDir,
      },
      transport.driver,
      { onEmitAfterDispose: (message) => emittedAfterDispose.push(message) },
    ));
  } catch (error) {
    client.close();
    await rm(storageDir, { recursive: true, force: true });
    throw error;
  }

  return {
    client,
    driver,
    storageDir,
    messages,
    protocolErrors,
    emittedAfterDispose,
    statuses: () =>
      messages.flatMap((message) =>
        message.type === "status" ? [message.status] : [],
      ),
    async close() {
      // Answers `internal` if it was already disposed.
      await client.dispose().catch(() => undefined);
      client.close();
      await rm(storageDir, { recursive: true, force: true });
    },
  };
}
