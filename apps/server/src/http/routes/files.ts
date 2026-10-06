// SPDX-FileCopyrightText: 2026 Open Print Stack contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { createWriteStream } from "node:fs";
import { rm } from "node:fs/promises";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";

import { createRoute } from "@hono/zod-openapi";
import { PrinterFile } from "@openprintstack/protocol";
import { z } from "zod";

import { checkCommand } from "../../commands/command-service.ts";
import { newId } from "../../ids.ts";
import { stagedFilePath } from "../../paths.ts";
import { HttpError } from "../errors.ts";
import { requireSession } from "../middleware/session.ts";
import {
  CommandResult,
  errorResponses,
  jsonResponse,
  PrinterIdParams,
  SESSION_SECURITY,
} from "../schemas.ts";
import { newRoutes } from "../validation.ts";
import { commandReply } from "./commands.ts";
import { printerNotFound } from "./printers.ts";

// A printer's files, and uploads. An upload is checked before its body is
// read, then streamed to staging/<uuid>, sent to the printer as a file.upload
// command, and deleted from staging whatever happened (drivers copy it):
//
//   printer exists (404) → name (400) → Content-Length (411)
//   → checkCommand with that size: capabilities, online, status, size
//     (422 unsupported, 409 printer_offline / invalid_state, 413 file_too_large)
//   → stream to staging (400 upload_incomplete if it ends early)
//   → execute: file.upload, 10 min → staged file deleted

/** The most UTF-8 bytes in a file name, as most file systems allow. */
const MAX_NAME_BYTES = 255;

/**
 * A file name that's safe as one path segment anywhere: 1–255 UTF-8 bytes, no
 * slash, backslash or control character, and not "." or "..". Anything
 * printer-specific is left to the capabilities check and the driver.
 */
export const FileName = z
  .string()
  .superRefine((name, ctx) => {
    const problem =
      name.length === 0
        ? "Must not be empty."
        : Buffer.byteLength(name, "utf8") > MAX_NAME_BYTES
          ? `Must be at most ${MAX_NAME_BYTES} bytes in UTF-8.`
          : name === "." || name === ".."
            ? "Must not be . or .."
            : /[/\\]/.test(name)
              ? "Must not contain / or \\."
              : /\p{Cc}/u.test(name)
                ? "Must not contain control characters."
                : undefined;
    if (problem !== undefined) {
      ctx.addIssue({ code: "custom", message: problem });
    }
  })
  .meta({
    description:
      "The file's name on the printer: 1–255 bytes in UTF-8, with no /, \\ or control characters, and not . or ... Percent-encode it in the path.",
  });

const FileParams = PrinterIdParams.extend({ fileName: FileName });

const listFiles = createRoute({
  method: "get",
  path: "/api/printers/{id}/files",
  operationId: "listFiles",
  tags: ["files"],
  summary: "The files on a printer",
  security: SESSION_SECURITY,
  middleware: requireSession,
  request: { params: PrinterIdParams },
  responses: {
    200: jsonResponse(
      z.object({ files: z.array(PrinterFile) }),
      "The printer's files, as its driver lists them.",
    ),
    ...errorResponses(400, 401, 404, 409, 422, 504),
  },
});

const uploadFile = createRoute({
  method: "put",
  path: "/api/printers/{id}/files/{fileName}",
  operationId: "uploadFile",
  tags: ["files"],
  summary: "Upload a file to a printer",
  description:
    "The body is the file itself, with a Content-Length (chunked uploads get 411). The printer's file types, state and size limit are checked before the body is read. A file of the same name is replaced. Publishes command.requested and command.result for the file.upload command.",
  security: SESSION_SECURITY,
  middleware: requireSession,
  request: {
    params: FileParams,
    body: {
      required: true,
      content: {
        "application/octet-stream": {
          schema: {
            type: "string",
            contentMediaType: "application/octet-stream",
          },
        },
      },
    },
  },
  responses: {
    200: jsonResponse(CommandResult, "The printer has the file."),
    ...errorResponses(400, 401, 404, 409, 411, 413, 422, 504),
  },
});

export function fileRoutes() {
  const routes = newRoutes();

  routes.openapi(listFiles, async (c) => {
    const { id } = c.req.valid("param");
    const { files } = await c.var.deps.printers.listFiles(id);
    return c.json({ files }, 200);
  });

  routes.openapi(uploadFile, async (c) => {
    const { deps, user } = c.var;
    const { id, fileName } = c.req.valid("param");
    if (!deps.printers.has(id)) throw printerNotFound(id);
    const sizeBytes = claimedSize(
      c.req.header("content-length"),
      c.req.header("transfer-encoding"),
    );
    const command = {
      kind: "file.upload",
      stagedFileId: newId(),
      fileName,
      sizeBytes,
    } as const;
    // Steps 4–7 of a command, before a byte of the body is read.
    const refusal = checkCommand(deps.store.get(id)?.state, command);
    if (refusal !== null) throw new HttpError(refusal.code, refusal.message);

    const staged = stagedFilePath(deps.paths, command.stagedFileId);
    try {
      await receive(c.req.raw.body, staged, sizeBytes);
      const result = await deps.commands.execute({
        printerId: id,
        command,
        userId: user.id,
      });
      return c.json(commandReply(result), 200);
    } finally {
      await rm(staged, { force: true });
    }
  });

  return routes;
}

/** The upload's size from its Content-Length, or 411. */
function claimedSize(
  contentLength: string | undefined,
  transferEncoding: string | undefined,
): number {
  const size =
    transferEncoding === undefined && contentLength !== undefined
      ? /^\d+$/.test(contentLength)
        ? Number(contentLength)
        : NaN
      : NaN;
  if (!Number.isSafeInteger(size)) {
    throw new HttpError(
      "length_required",
      "Send the file with a Content-Length giving its size in bytes; chunked uploads aren't accepted.",
    );
  }
  return size;
}

/**
 * Streams the body to `file`, which mustn't exist. Fails with
 * upload_incomplete if the body isn't exactly `expected` bytes or breaks off.
 */
async function receive(
  body: ReadableStream<Uint8Array> | null,
  file: string,
  expected: number,
): Promise<void> {
  let received = 0;
  const counter = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      received += chunk.length;
      callback(
        received > expected ? new Error("More bytes than claimed.") : null,
        chunk,
      );
    },
  });
  try {
    await pipeline(
      body === null ? Readable.from([]) : Readable.fromWeb(body),
      counter,
      createWriteStream(file, { flags: "wx", mode: 0o600 }),
    );
  } catch (error) {
    throw new HttpError(
      "upload_incomplete",
      "The upload broke off or was longer than its Content-Length.",
      { cause: error },
    );
  }
  if (received !== expected) {
    throw new HttpError(
      "upload_incomplete",
      `The upload ended after ${received} of ${expected} bytes.`,
    );
  }
}
