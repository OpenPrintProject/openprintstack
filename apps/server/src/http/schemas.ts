// SPDX-FileCopyrightText: 2026 Open Print Stack contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { ApiError, Id } from "@openprintstack/protocol";
import { z } from "zod";

// Pieces the route definitions share. Protocol's schemas are reused as they
// are; these are the API's own.

/** The `{id}` of every /api/printers/{id} route. */
export const PrinterIdParams = z.object({
  id: Id.meta({ description: "The printer's id." }),
});

/** A command that ran and succeeded. */
export const CommandResult = z
  .object({
    commandId: Id,
    ok: z.literal(true),
    durationMs: z.number().nonnegative(),
  })
  .meta({
    id: "CommandResult",
    description:
      "The command succeeded. A refused or failed command answers with an ApiError instead, whose details are { commandId, durationMs } once the command has been requested.",
  });

export type CommandResult = z.infer<typeof CommandResult>;

/** The security requirement of every route that needs a login. */
export const SESSION_SECURITY = [{ session: [] }];

const ERROR_DESCRIPTIONS = {
  400: "The request isn't valid: validation_failed, invalid_json or upload_incomplete.",
  401: "Not logged in: unauthenticated, or setup_required while no user exists. On login, invalid_credentials.",
  403: "The Host or Origin header isn't allowed: host_not_allowed or origin_not_allowed.",
  404: "Not found: not_found, printer_not_found or file_not_found.",
  409: "It conflicts with the current state, e.g. printer_busy, printer_offline, invalid_state, name_taken, job_active or setup_done.",
  411: "length_required: the upload has no Content-Length.",
  413: "payload_too_large (over 64 KiB of JSON) or file_too_large.",
  415: "unsupported_media_type: the body must be JSON.",
  422: "The printer can't or won't do it: unsupported, unsafe, printer_rejected, unknown_driver_type or invalid_settings.",
  429: "too_many_attempts: too many failed logins. Retry-After says how many seconds to wait.",
  500: "internal: the server or the driver failed.",
  504: "timeout: the printer didn't answer in time.",
} as const;

type ErrorStatus = keyof typeof ERROR_DESCRIPTIONS;

type ErrorResponse = {
  description: string;
  headers?: Record<string, { description: string; schema: object }>;
  content: { "application/json": { schema: typeof ApiError } };
};

/**
 * The route's error responses: the given statuses, plus 403 (the Host and
 * Origin checks apply everywhere) and 500.
 */
export function errorResponses<S extends ErrorStatus>(
  ...statuses: S[]
): Record<S | 403 | 500, ErrorResponse> {
  const all = [...new Set<ErrorStatus>([...statuses, 403, 500])].sort(
    (a, b) => a - b,
  );
  return Object.fromEntries(
    all.map((status) => [
      status,
      {
        description: ERROR_DESCRIPTIONS[status],
        ...(status === 429 && {
          headers: {
            "Retry-After": {
              description: "How many seconds to wait before trying again.",
              schema: { type: "integer", minimum: 1 },
            },
          },
        }),
        content: { "application/json": { schema: ApiError } },
      },
    ]),
  ) as Record<S | 403 | 500, ErrorResponse>;
}

/** A JSON response with this schema. */
export function jsonResponse<T extends z.ZodType>(
  schema: T,
  description: string,
) {
  return { description, content: { "application/json": { schema } } };
}

/** A JSON request body with this schema. */
export function jsonBody<T extends z.ZodType>(
  schema: T,
  options: { required: boolean } = { required: true },
) {
  return {
    required: options.required,
    content: { "application/json": { schema } },
  };
}
