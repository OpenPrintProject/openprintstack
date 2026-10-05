// SPDX-FileCopyrightText: 2026 Open Print Stack contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { z } from "zod";

/**
 * Why a driver call failed:
 *
 * - `not_supported`: the printer or driver can't do this at all.
 * - `invalid_state`: it can, but not in the printer's current state.
 * - `offline`: the printer isn't connected.
 * - `timeout`: the printer or driver didn't answer in time.
 * - `file_not_found`: the file isn't on the printer.
 * - `printer_rejected`: the printer refused the request.
 * - `internal`: a bug or an unexpected failure in the driver.
 */
export const DriverErrorCode = z.enum([
  "not_supported",
  "invalid_state",
  "offline",
  "timeout",
  "file_not_found",
  "printer_rejected",
  "internal",
]);

export type DriverErrorCode = z.infer<typeof DriverErrorCode>;

/** How a `DriverError` crosses the transport. */
export const DriverErrorInfo = z.object({
  code: DriverErrorCode,
  message: z.string(),
});

export type DriverErrorInfo = z.infer<typeof DriverErrorInfo>;

/**
 * The error every driver method throws. The transport carries only its code
 * and message (structuredClone drops custom properties from errors), and the
 * host's client throws an equal `DriverError` again.
 */
export class DriverError extends Error {
  override name = "DriverError";
  readonly code: DriverErrorCode;

  constructor(code: DriverErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.code = code;
  }

  toInfo(): DriverErrorInfo {
    return { code: this.code, message: this.message };
  }
}

/**
 * Returns `error` if it is a `DriverError`, and otherwise wraps it as an
 * `internal` one that keeps the original as its `cause`.
 */
export function toDriverError(error: unknown): DriverError {
  if (error instanceof DriverError) {
    return error;
  }
  const message =
    error instanceof Error ? error.message : "The driver threw a non-error.";
  return new DriverError("internal", message, { cause: error });
}
