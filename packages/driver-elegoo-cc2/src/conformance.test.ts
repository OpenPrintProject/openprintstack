// SPDX-FileCopyrightText: 2026 Open Print Stack contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

// The driver-sdk conformance kit, against the fake CC2 on loopback.

import { describeDriverConformance } from "@openprintstack/driver-sdk/testing";
import { afterAll, describe } from "vitest";

import { createElegooCc2Driver } from "./index.ts";
import { FakeCc2 } from "./testing/index.ts";
import { TEST_TIMINGS } from "./test-utils.ts";

const fake = await FakeCc2.start();
afterAll(() => fake.close());

const settings = { host: fake.host, accessCode: fake.accessCode };
const module = createElegooCc2Driver({
  ports: fake.ports,
  timings: TEST_TIMINGS,
});

describeDriverConformance(module, { settings, quietPeriodMs: 500 });

describe("when the printer can't be reached", () => {
  // Connecting still reports a status (offline), and nothing else breaks.
  describeDriverConformance(
    createElegooCc2Driver({
      ports: { mqtt: 1, udp: 1 },
      timings: TEST_TIMINGS,
    }),
    { settings, quietPeriodMs: 500 },
  );
});
