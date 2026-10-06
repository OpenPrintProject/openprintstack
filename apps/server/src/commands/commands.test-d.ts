// SPDX-FileCopyrightText: 2026 Open Print Stack contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { EventPayload, ErrorInfo } from "@openprintstack/protocol";
import { describe, expectTypeOf, it } from "vitest";

import type { PrinterServiceError } from "../printers/printer-service.ts";
import type {
  CommandResult,
  CommandService,
  checkCommand,
} from "./command-service.ts";
import type { CommandError, CommandErrorCode } from "./errors.ts";
import type { checkSafety } from "./safety.ts";

describe("command results", () => {
  it("are exactly what command.result carries", () => {
    expectTypeOf<CommandResult>().toEqualTypeOf<
      EventPayload<"command.result">
    >();
    expectTypeOf<
      CommandService["execute"]
    >().returns.resolves.toEqualTypeOf<CommandResult>();
  });

  it("fail with a known code, as protocol's ErrorInfo", () => {
    expectTypeOf<CommandError>().toExtend<ErrorInfo>();
    expectTypeOf<CommandError["code"]>().toEqualTypeOf<CommandErrorCode>();
  });
});

describe("the checks", () => {
  it("are synchronous, returning the refusal or null", () => {
    expectTypeOf<
      ReturnType<typeof checkSafety>
    >().toEqualTypeOf<CommandError | null>();
    expectTypeOf<
      ReturnType<typeof checkCommand>
    >().toEqualTypeOf<CommandError | null>();
  });
});

describe("PrinterServiceError", () => {
  it("has the lifecycle's codes", () => {
    expectTypeOf<PrinterServiceError["code"]>().toEqualTypeOf<
      | "printer_not_found"
      | "name_taken"
      | "unknown_driver_type"
      | "invalid_settings"
      | "job_active"
    >();
  });
});
