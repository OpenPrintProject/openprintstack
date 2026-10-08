// SPDX-FileCopyrightText: 2026 Open Print Stack contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { setTimeout as sleep } from "node:timers/promises";

import { Capabilities } from "@openprintstack/protocol";
import { expect } from "vitest";
import type { z } from "zod";

import {
  DriverManifest,
  type DriverModule,
  type SettingsSchema,
} from "../contract.ts";
import { DRIVER_OPS, type DriverCall } from "../ops.ts";
import { assertSerializable } from "../serializable.ts";
import { defaultSettings, settingsJsonSchema } from "../settings.ts";
import { createDriverHarness, type DriverHarness } from "./harness.ts";

// The checks behind describeDriverConformance. They only connect, list and
// take snapshots: nothing moves, heats or prints, so they are safe to run
// against a real printer's mock.

export interface ConformanceFixture<S extends SettingsSchema = SettingsSchema> {
  /** Settings to create the driver with, as a user would enter them. */
  settings: z.input<S>;
  /** How long each driver call may take. Default: 5000 ms. */
  timeoutMs?: number;
  /** How long to watch for messages after `dispose`. Default: 1000 ms. */
  quietPeriodMs?: number;
}

export interface CheckContext {
  module: DriverModule;
  fixture: Required<ConformanceFixture>;
  /** Marks the check as skipped, e.g. when the printer has no cameras. */
  skip(note: string): never;
}

export interface ConformanceCheck {
  name: string;
  /** Throws (or rejects) if the driver fails the check. */
  run(context: CheckContext): Promise<void> | void;
}

const FLAT_TYPES = new Set(["string", "number", "integer", "boolean"]);

const UNKNOWN_OP = {
  op: "conformanceUnknownOp",
  args: {},
} as unknown as DriverCall;

export const CONFORMANCE_CHECKS: readonly ConformanceCheck[] = [
  {
    name: "has a valid manifest",
    run: ({ module }) => {
      DriverManifest.parse(module.manifest);
    },
  },
  {
    name: "has a flat settings schema the UI can render as a form",
    run: ({ module }) => {
      // Throws if a field can't be described in JSON Schema.
      const schema = settingsJsonSchema(module);

      expect(schema.type).toBe("object");
      const nested = Object.entries(schema.properties ?? {})
        .filter(
          ([, property]) =>
            typeof property !== "object" ||
            typeof property.type !== "string" ||
            !FLAT_TYPES.has(property.type),
        )
        .map(([key]) => key);
      expect(
        nested,
        "Settings must be strings, numbers, booleans or enums (use optional, not nullable)",
      ).toEqual([]);
    },
  },
  {
    name: "marks only plain strings with no default as write-only",
    run: ({ module }) => {
      const properties = settingsJsonSchema(module).properties ?? {};
      const marked = Object.entries(properties).flatMap(([key, property]) =>
        typeof property === "object" && "writeOnly" in property
          ? [[key, property] as const]
          : [],
      );
      const notBoolean = marked
        .filter(([, property]) => typeof property.writeOnly !== "boolean")
        .map(([key]) => key);
      expect(notBoolean, "writeOnly must be true or false").toEqual([]);
      // A default is published with the schema, and a choice from a list
      // isn't a secret, so neither can be write-only.
      const wrong = marked
        .filter(
          ([, property]) =>
            property.writeOnly === true &&
            (property.type !== "string" ||
              "enum" in property ||
              "const" in property ||
              "default" in property),
        )
        .map(([key]) => key);
      expect(
        wrong,
        "Write-only settings must be strings with no default and no enum",
      ).toEqual([]);
    },
  },
  {
    name: "accepts the fixture's settings and its own defaults",
    run: ({ module, fixture }) => {
      module.settingsSchema.parse(fixture.settings);
      // Zod skips a field's checks when it fills in a default, so pass each
      // default explicitly.
      module.settingsSchema.parse({
        ...fixture.settings,
        ...defaultSettings(module),
      });
    },
  },
  {
    name: "reports valid initial capabilities",
    run: ({ module, fixture }) => {
      const settings = module.settingsSchema.parse(fixture.settings);
      const capabilities = module.initialCapabilities(settings);

      assertSerializable(capabilities, "capabilities");
      Capabilities.parse(capabilities);
    },
  },
  {
    name: "connects and reports a status",
    run: (context) =>
      withHarness(context, async (harness) => {
        await harness.client.connect();

        expect(harness.statuses()).not.toEqual([]);
      }),
  },
  {
    name: "implements every required method",
    run: (context) =>
      withHarness(context, async (harness) => {
        const methods = harness.driver as unknown as Record<string, unknown>;
        const missing = DRIVER_OPS.filter(
          (op) => op !== "invokeExtension" && typeof methods[op] !== "function",
        );
        expect(missing).toEqual([]);

        await harness.client.connect();
        const capabilities = currentCapabilities(context, harness);
        if (
          capabilities.extensions.length > 0 ||
          capabilities.commands.includes("extension.invoke")
        ) {
          expect(
            typeof methods.invokeExtension,
            "It declares extensions, so it needs invokeExtension",
          ).toBe("function");
        }
      }),
  },
  {
    name: "lists its files",
    run: (context) =>
      withHarness(context, async (harness) => {
        await harness.client.connect();
        if (!currentCapabilities(context, harness).files.list) {
          context.skip("The printer can't list files.");
        }

        // The client rejects a result that doesn't match ListFilesResult.
        await harness.client.listFiles();
      }),
  },
  {
    name: "lists its cameras and takes a snapshot from each",
    run: (context) =>
      withHarness(context, async (harness) => {
        await harness.client.connect();
        if (!currentCapabilities(context, harness).cameras.snapshot) {
          context.skip("The printer has no camera snapshots.");
        }

        const { cameras } = await harness.client.listCameras();
        expect(cameras).not.toEqual([]);
        for (const camera of cameras) {
          const snapshot = await harness.client.getSnapshot({
            cameraId: camera.id,
          });
          expect(snapshot.data.byteLength).toBeGreaterThan(0);
        }
      }),
  },
  {
    name: "answers an unknown op with not_supported",
    run: (context) =>
      withHarness(context, async (harness) => {
        await expect(harness.client.call(UNKNOWN_OP)).rejects.toMatchObject({
          code: "not_supported",
        });
      }),
  },
  {
    name: "answers an unknown extension with not_supported",
    run: (context) =>
      withHarness(context, async (harness) => {
        await harness.client.connect();

        await expect(
          harness.client.invokeExtension({
            extension: "conformance-unknown",
            action: "noop",
            params: null,
          }),
        ).rejects.toMatchObject({ code: "not_supported" });
      }),
  },
  {
    name: "reports offline after disconnect",
    run: (context) =>
      withHarness(context, async (harness) => {
        await harness.client.connect();
        await harness.client.disconnect();

        expect(harness.statuses().at(-1)).toBe("offline");
      }),
  },
  {
    name: "emits nothing after dispose",
    run: (context) =>
      withHarness(context, async (harness) => {
        await harness.client.connect();
        await harness.client.dispose();
        const count = harness.messages.length;
        await sleep(context.fixture.quietPeriodMs);

        expect(harness.emittedAfterDispose).toEqual([]);
        expect(harness.messages).toHaveLength(count);
      }),
  },
];

/** Runs `test` on a fresh driver, then checks it sent nothing invalid. */
async function withHarness(
  { module, fixture }: CheckContext,
  test: (harness: DriverHarness) => Promise<void>,
): Promise<void> {
  const harness = await createDriverHarness(module, {
    settings: fixture.settings,
    timeoutMs: fixture.timeoutMs,
  });
  try {
    await test(harness);

    if (harness.protocolErrors.length > 0) {
      const errors = harness.protocolErrors.map((error) => error.message);
      throw new Error(
        `The driver sent things the host would reject:\n${errors.join("\n")}`,
      );
    }
  } finally {
    await harness.close();
  }
}

/** The last capabilities the driver reported, or its initial ones. */
function currentCapabilities(
  { module, fixture }: CheckContext,
  harness: DriverHarness,
): Capabilities {
  const reported = harness.messages.findLast(
    (message) => message.type === "capabilities",
  );
  return reported?.type === "capabilities"
    ? reported.capabilities
    : module.initialCapabilities(module.settingsSchema.parse(fixture.settings));
}
