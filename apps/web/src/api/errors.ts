// SPDX-FileCopyrightText: 2026 Open Print Stack contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { ApiError } from "@openprintstack/protocol";

// What a failed request leaves in a query or mutation's `error`:
//
//   an ApiError body   { error: { code, message } }: the server's answer, or
//                      one the client made for an answer that had none (below)
//   a TypeError        fetch itself failed: the server is unreachable
//
// openapi-fetch and openapi-react-query pass error bodies on as they are, and
// these helpers read them.

/**
 * The code the client gives an error answer that isn't an ApiError (say, an
 * empty 500 from Vite's proxy while the server is down). `details.status` is
 * the HTTP status.
 */
export const UNEXPECTED_RESPONSE = "unexpected_response";

/** The codes of the server's 5xx answers, which are worth retrying. */
const SERVER_ERROR_CODES = new Set(["internal", "timeout"]);

/** The error's ApiError body, if it has one. */
export function apiError(error: unknown): ApiError["error"] | undefined {
  const parsed = ApiError.safeParse(error);
  return parsed.success ? parsed.data.error : undefined;
}

/** The error's ApiError code, e.g. `invalid_credentials`. */
export function errorCode(error: unknown): string | undefined {
  return apiError(error)?.code;
}

/** A sentence for the UI that says what went wrong. */
export function errorMessage(error: unknown): string {
  const body = apiError(error);
  if (body !== undefined) return body.message;
  if (error instanceof TypeError) {
    return "Can't reach the server. Check that it's running, then try again.";
  }
  return "Something went wrong. Try again.";
}

/**
 * Whether a query is worth retrying: the server was unreachable or failed
 * (5xx). A 4xx answer won't change by asking again.
 */
export function isRetryable(error: unknown): boolean {
  if (error instanceof TypeError) return true;
  const body = apiError(error);
  if (body === undefined) return false;
  if (body.code === UNEXPECTED_RESPONSE) {
    const status = (body.details as { status?: unknown } | undefined)?.status;
    return typeof status === "number" && status >= 500;
  }
  return SERVER_ERROR_CODES.has(body.code);
}

/**
 * An ApiError body for an error answer that has none. openapi-fetch reads an
 * empty error body as no error at all, and openapi-react-query then resolves
 * the query with null, so every error answer must carry a body.
 */
export function unexpectedResponse(status: number): ApiError {
  return {
    error: {
      code: UNEXPECTED_RESPONSE,
      message: `The server answered with HTTP ${status} and no explanation. Check that it's running, then try again.`,
      details: { status },
    },
  };
}
