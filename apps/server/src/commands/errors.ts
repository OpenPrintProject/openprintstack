// SPDX-FileCopyrightText: 2026 Open Print Stack contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  type DriverErrorCode,
  toDriverError,
} from "@openprintstack/driver-sdk";

/**
 * Every code a command can fail with. Suggested HTTP statuses for PR 8 are in
 * the comments.
 */
export const COMMAND_ERROR_CODES = [
  // The server's own checks.
  "printer_busy", // 409: another command is running on the printer
  "unsupported", // 422: the printer doesn't have that command, heater, fan...
  "printer_offline", // 409
  "invalid_state", // 409: not in the printer's current status
  "unsafe", // 422: outside the printer's limits
  "file_too_large", // 413
  // Only from drivers.
  "timeout", // 504
  "file_not_found", // 404
  "printer_rejected", // 422
  "internal", // 500
] as const;

export type CommandErrorCode = (typeof COMMAND_ERROR_CODES)[number];

/** Why a command failed, as `command.result` reports it. */
export type CommandError = {
  code: CommandErrorCode;
  message: string;
};

/** Driver codes that mean the same as a check's take the check's code. */
const FROM_DRIVER: Readonly<Record<DriverErrorCode, CommandErrorCode>> = {
  not_supported: "unsupported",
  invalid_state: "invalid_state",
  offline: "printer_offline",
  timeout: "timeout",
  file_not_found: "file_not_found",
  printer_rejected: "printer_rejected",
  internal: "internal",
};

/**
 * A failed driver call as a command error: the driver's own message, with
 * its code in the server's vocabulary. Anything that isn't a `DriverError`
 * is `internal`, keeping its message.
 */
export function fromDriverError(error: unknown): CommandError {
  const driverError = toDriverError(error);
  return {
    code: FROM_DRIVER[driverError.code],
    message: driverError.message,
  };
}
