// SPDX-FileCopyrightText: 2026 Open Print Stack contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

// Everything in the protocol must cross a worker boundary (structuredClone)
// and the network (JSON) unchanged.

import { describe, expect, it } from "vitest";
import type { z } from "zod";

import {
  apiErrorFixture,
  cameraFixture,
  capabilitiesFixture,
  commandFixtures,
  eventFixtures,
  filamentFixture,
  printerFileFixtures,
  snapshotFixture,
  wsClientMessageFixtures,
  wsServerMessageFixtures,
} from "./fixtures.ts";
import {
  ApiError,
  Camera,
  Capabilities,
  Filament,
  OpsEvent,
  PrinterCommand,
  PrinterFile,
  PrinterSnapshot,
  WsClientMessage,
  WsServerMessage,
} from "./index.ts";

type Case = [name: string, schema: z.ZodType, value: unknown];

const cases: Case[] = [
  ...Object.values(eventFixtures).map((event): Case => [
    `event ${event.type}`,
    OpsEvent,
    event,
  ]),
  ...Object.values(commandFixtures).map((command): Case => [
    `command ${command.kind}`,
    PrinterCommand,
    command,
  ]),
  ...wsClientMessageFixtures.map((message, i): Case => [
    `client message ${i} (${message.type})`,
    WsClientMessage,
    message,
  ]),
  ...wsServerMessageFixtures.map((message, i): Case => [
    `server message ${i} (${message.type})`,
    WsServerMessage,
    message,
  ]),
  ...printerFileFixtures.map((file): Case => [
    `printer file ${file.name}`,
    PrinterFile,
    file,
  ]),
  ["camera", Camera, cameraFixture],
  [
    "capabilities with a read-only heater",
    Capabilities,
    {
      ...capabilitiesFixture,
      heaters: [
        ...capabilitiesFixture.heaters,
        {
          id: "chamber",
          kind: "chamber",
          label: "Chamber",
          controllable: false,
          maxC: null,
        },
      ],
    },
  ],
  ["filament", Filament, filamentFixture],
  ["filament with nothing attached", Filament, { units: [] }],
  ["printer snapshot", PrinterSnapshot, snapshotFixture],
  [
    "printer snapshot without filament",
    PrinterSnapshot,
    { ...snapshotFixture, state: { ...snapshotFixture.state, filament: null } },
  ],
  ["API error", ApiError, apiErrorFixture],
];

describe.each(cases)("%s", (_name, schema, value) => {
  it("parses to itself", () => {
    expect(schema.parse(value)).toStrictEqual(value);
  });

  it("survives structuredClone", () => {
    expect(schema.parse(structuredClone(value))).toStrictEqual(value);
  });

  it("survives a JSON round trip", () => {
    const text = JSON.stringify(value);

    expect(schema.parse(JSON.parse(text))).toStrictEqual(value);
  });
});
