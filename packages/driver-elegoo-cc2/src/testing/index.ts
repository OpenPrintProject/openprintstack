// SPDX-FileCopyrightText: 2026 Open Print Stack contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

// Test helpers for the CC2 driver. This entry point loads aedes, a
// devDependency, so only tests may import it.

export {
  FAKE_ACCESS_CODE,
  FAKE_MODEL,
  FAKE_NAME,
  FAKE_SERIAL,
  FakeCc2,
  type FakeCc2Options,
  type FakeRequest,
  idleStatus,
} from "./fake-cc2.ts";
