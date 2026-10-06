// SPDX-FileCopyrightText: 2026 Open Print Stack contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { DriverError } from "@openprintstack/driver-sdk";
import type { ApiError, JsonValue } from "@openprintstack/protocol";
import type { Context, ErrorHandler, NotFoundHandler } from "hono";
import { HTTPException } from "hono/http-exception";
import type { ContentfulStatusCode } from "hono/utils/http-status";

import { type CommandErrorCode, fromDriverError } from "../commands/errors.ts";
import type { Logger } from "../logger.ts";
import {
  PrinterServiceError,
  type PrinterServiceErrorCode,
} from "../printers/printer-service.ts";

// Every error the API answers with is protocol's ApiError body,
// { error: { code, message, details? } }, with the status for its code. This
// table is the one place codes get their statuses.

const COMMAND_STATUS = {
  printer_busy: 409,
  unsupported: 422,
  printer_offline: 409,
  invalid_state: 409,
  unsafe: 422,
  file_too_large: 413,
  timeout: 504,
  file_not_found: 404,
  printer_rejected: 422,
  internal: 500,
} as const satisfies Record<CommandErrorCode, ContentfulStatusCode>;

const PRINTER_STATUS = {
  printer_not_found: 404,
  name_taken: 409,
  unknown_driver_type: 422,
  invalid_settings: 422,
  job_active: 409,
} as const satisfies Record<PrinterServiceErrorCode, ContentfulStatusCode>;

const HTTP_STATUS = {
  validation_failed: 400,
  invalid_json: 400,
  upload_incomplete: 400,
  unauthenticated: 401,
  setup_required: 401,
  invalid_credentials: 401,
  host_not_allowed: 403,
  origin_not_allowed: 403,
  not_found: 404,
  setup_done: 409,
  length_required: 411,
  payload_too_large: 413,
  unsupported_media_type: 415,
  upgrade_required: 426,
  too_many_attempts: 429,
} as const satisfies Record<string, ContentfulStatusCode>;

/** The HTTP status of every error code the API uses. */
export const ERROR_STATUS = {
  ...COMMAND_STATUS,
  ...PRINTER_STATUS,
  ...HTTP_STATUS,
} as const;

export type ApiErrorCode = keyof typeof ERROR_STATUS;

export function isApiErrorCode(code: string): code is ApiErrorCode {
  return Object.hasOwn(ERROR_STATUS, code);
}

/** An error answered as an ApiError body with its code's status. */
export class HttpError extends Error {
  override name = "HttpError";
  readonly code: ApiErrorCode;
  readonly status: ContentfulStatusCode;
  readonly details: JsonValue | undefined;
  readonly headers: Readonly<Record<string, string>>;

  constructor(
    code: ApiErrorCode,
    message: string,
    options?: ErrorOptions & {
      details?: JsonValue;
      headers?: Record<string, string>;
    },
  ) {
    super(message, options);
    this.code = code;
    this.status = ERROR_STATUS[code];
    this.details = options?.details;
    this.headers = options?.headers ?? {};
  }
}

/**
 * The HTTP error for something a route or service threw, or undefined if it
 * was unexpected (a bug), which becomes a 500.
 */
export function toHttpError(error: unknown): HttpError | undefined {
  if (error instanceof HttpError) return error;
  if (error instanceof PrinterServiceError) {
    return new HttpError(error.code, error.message, {
      cause: error,
      ...(error.code === "invalid_settings" && {
        details: asJson(error.details),
      }),
    });
  }
  if (error instanceof DriverError) {
    const { code, message } = fromDriverError(error);
    return new HttpError(code, message, { cause: error });
  }
  if (error instanceof HTTPException) {
    // Hono's own: its JSON validator, and @hono/zod-openapi's media type check.
    switch (error.status) {
      case 400:
        return new HttpError("invalid_json", "The body isn't valid JSON.", {
          cause: error,
        });
      case 415:
        return new HttpError(
          "unsupported_media_type",
          "The body must be JSON, sent with Content-Type: application/json.",
          { cause: error },
        );
    }
  }
  return undefined;
}

/** The response for an HTTP error. */
export function errorResponse(c: Context, error: HttpError): Response {
  const body: ApiError = {
    error: {
      code: error.code,
      message: error.message,
      ...(error.details !== undefined && { details: error.details }),
    },
  };
  return c.json(body, error.status, error.headers);
}

/**
 * Answers every thrown error as an ApiError. Unexpected errors become 500
 * internal, with nothing about them sent to the client. Every 5xx is logged at
 * error with its stack.
 */
export function errorHandler(logger: Logger): ErrorHandler {
  const log = logger.child({ component: "http" });
  return (error, c) => {
    const known = toHttpError(error);
    const answer =
      known ??
      new HttpError("internal", "Something went wrong on the server.", {
        cause: error,
      });
    if (answer.status >= 500) {
      log.error(
        { err: error, method: c.req.method, path: c.req.path },
        known
          ? "A request failed on the server"
          : "A request failed unexpectedly",
      );
    }
    return errorResponse(c, answer);
  };
}

export const notFoundHandler: NotFoundHandler = (c) =>
  errorResponse(
    c,
    new HttpError(
      "not_found",
      `There's nothing at ${c.req.method} ${c.req.path}.`,
    ),
  );

/** A copy that's certainly JSON, e.g. of Zod's issues. */
export function asJson(value: unknown): JsonValue {
  return JSON.parse(JSON.stringify(value) ?? "null") as JsonValue;
}
