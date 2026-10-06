// SPDX-FileCopyrightText: 2026 Open Print Stack contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { SessionUser } from "@openprintstack/protocol";
import { describe, expectTypeOf, it } from "vitest";

import type { CommandErrorCode } from "../commands/errors.ts";
import type { PrinterServiceErrorCode } from "../printers/printer-service.ts";
import type { AppEnv, SessionEnv } from "./context.ts";
import type { ApiErrorCode } from "./errors.ts";

describe("HTTP types", () => {
  it("give every command and printer error code a status", () => {
    expectTypeOf<CommandErrorCode>().toExtend<ApiErrorCode>();
    expectTypeOf<PrinterServiceErrorCode>().toExtend<ApiErrorCode>();
  });

  it("give routes behind requireSession a user, and others maybe none", () => {
    expectTypeOf<
      SessionEnv["Variables"]["user"]
    >().toEqualTypeOf<SessionUser>();
    expectTypeOf<
      SessionEnv["Variables"]["sessionId"]
    >().toEqualTypeOf<string>();
    expectTypeOf<AppEnv["Variables"]["user"]>().toEqualTypeOf<
      SessionUser | undefined
    >();
  });
});
