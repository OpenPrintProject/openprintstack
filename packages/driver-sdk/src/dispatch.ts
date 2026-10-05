// SPDX-FileCopyrightText: 2026 Open Print Stack contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { PrinterDriver } from "./contract.ts";
import { DriverError, toDriverError } from "./errors.ts";
import { DRIVER_OP_RESULTS, isDriverOp } from "./ops.ts";
import type { DriverResponse } from "./wire.ts";

/** A request whose envelope has been checked, but not its op or args. */
export interface UncheckedRequest {
  id: number;
  op: string;
  args: Record<string, unknown>;
}

/**
 * Runs one request against a driver and turns the outcome into a response.
 * It never throws: an unknown op, or an optional method the driver doesn't
 * have, answers `not_supported`, and anything the method throws becomes a
 * `DriverError` (`internal` unless it already was one).
 */
export async function dispatch(
  driver: PrinterDriver,
  request: UncheckedRequest,
): Promise<DriverResponse> {
  const { id, op, args } = request;
  if (!isDriverOp(op)) {
    return failure(id, new DriverError("not_supported", `Unknown op "${op}".`));
  }
  // Looked up as plain properties, so an optional method can be missing.
  const methods = driver as unknown as Partial<
    Record<string, (args: unknown) => Promise<unknown>>
  >;
  const method = methods[op];
  if (typeof method !== "function") {
    return failure(
      id,
      new DriverError("not_supported", `This driver has no "${op}".`),
    );
  }
  try {
    const result = await method.call(driver, args);
    const resolvesWithNothing = DRIVER_OP_RESULTS[op] === null;
    // Results are only checked by the host's client, against the op's schema.
    return {
      type: "response",
      id,
      ok: true,
      result: resolvesWithNothing ? null : (result as SuccessResult),
    };
  } catch (error) {
    return failure(id, toDriverError(error));
  }
}

type SuccessResult = Extract<DriverResponse, { ok: true }>["result"];

function failure(id: number, error: DriverError): DriverResponse {
  return { type: "response", id, ok: false, error: error.toInfo() };
}
