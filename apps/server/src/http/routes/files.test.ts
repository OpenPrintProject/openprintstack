// SPDX-FileCopyrightText: 2026 Open Print Stack contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

import {
  DriverError,
  type ListFilesResult,
  type SendFileRequest,
} from "@openprintstack/driver-sdk";
import { describe, expect, it, vi } from "vitest";

import { JSON_BODY_LIMIT } from "../middleware/body-limit.ts";
import { apiError, testApp } from "../test-app.ts";
import { FileName } from "./files.ts";

async function withPrinter(driverType?: string) {
  const t = await testApp();
  const { token, user } = await t.setupAdmin();
  const id = await t.addPrinter(token, "Bench", {}, driverType);
  t.events.length = 0;
  const upload = (
    fileName: string,
    body: Uint8Array | string | ReadableStream<Uint8Array> | undefined,
    headers: Record<string, string> = {},
  ) =>
    t.call("PUT", `/api/printers/${id}/files/${fileName}`, {
      token,
      ...(body !== undefined && { body }),
      headers: {
        ...(typeof body === "string" && {
          "content-length": String(Buffer.byteLength(body)),
        }),
        ...(body instanceof Uint8Array && {
          "content-length": String(body.length),
        }),
        ...headers,
      },
    });
  const staged = () => readdir(t.paths.staging);
  return { ...t, token, user, id, upload, staged };
}

/**
 * A body that records whether anything read it. Its high-water mark is 0, so
 * nothing is pulled until something reads.
 */
function watchedBody(bytes: number) {
  const body = {
    pulled: false,
    stream: new ReadableStream<Uint8Array>(
      {
        pull(controller) {
          body.pulled = true;
          controller.enqueue(new Uint8Array(bytes));
          controller.close();
        },
      },
      { highWaterMark: 0 },
    ),
  };
  return body;
}

describe("PUT /api/printers/{id}/files/{fileName}", () => {
  it("stages the body, sends it to the printer, and answers 200", async () => {
    const t = await withPrinter();
    const driver = t.drivers.latest(t.id);
    let received: { request: SendFileRequest; content: string } | undefined;
    driver.handle("sendFile", async (args) => {
      const request = args as SendFileRequest;
      received = { request, content: await readFile(request.path, "utf8") };
    });

    const answer = await t.upload("benchy.gcode", "G28\nG1 X10\n");

    expect(answer.status).toBe(200);
    expect(await answer.json()).toMatchObject({ ok: true });
    expect(received?.content).toBe("G28\nG1 X10\n");
    expect(received?.request).toMatchObject({
      fileName: "benchy.gcode",
      sizeBytes: 11,
    });
    const staged = received?.request.path ?? "";
    expect(path.dirname(staged)).toBe(t.paths.staging);
    expect(path.basename(staged)).toMatch(/^[0-9a-f-]{36}$/);
    expect(t.events.map((event) => event.type)).toEqual([
      "command.requested",
      "command.result",
    ]);
    expect(t.events[0]?.payload).toMatchObject({
      command: {
        kind: "file.upload",
        fileName: "benchy.gcode",
        sizeBytes: 11,
      },
    });
  });

  it("deletes the staged file once the printer has it", async () => {
    const t = await withPrinter();

    await t.upload("a.gcode", "G28\n");

    expect(await t.staged()).toEqual([]);
  });

  it("deletes the staged file when the printer refuses it", async () => {
    const t = await withPrinter();
    t.drivers.latest(t.id).handle("sendFile", () => {
      throw new DriverError("printer_rejected", "Disk full.");
    });

    const answer = await t.upload("a.gcode", "G28\n");

    expect(answer.status).toBe(422);
    expect(await apiError(answer)).toMatchObject({
      code: "printer_rejected",
      message: "Disk full.",
    });
    expect(await t.staged()).toEqual([]);
  });

  it("takes an empty file", async () => {
    const t = await withPrinter();

    const answer = await t.upload("empty.gcode", "");

    expect(answer.status).toBe(200);
  });

  it("takes a percent-encoded name with spaces and accents", async () => {
    const t = await withPrinter();

    const answer = await t.upload(
      encodeURIComponent("Grüße – part 2.gcode"),
      "G28\n",
    );

    expect(answer.status).toBe(200);
    expect(t.drivers.latest(t.id).calls.at(-1)?.args).toMatchObject({
      fileName: "Grüße – part 2.gcode",
    });
  });

  describe("checks before reading the body", () => {
    it.each([
      [
        "a file type the printer doesn't take",
        "model.stl",
        10,
        422,
        "unsupported",
      ],
      [
        "a file over the printer's limit",
        "big.gcode",
        1001,
        413,
        "file_too_large",
      ],
    ])("refuses %s", async (_, name, size, status, code) => {
      const t = await withPrinter();
      const body = watchedBody(size);

      const answer = await t.upload(name, body.stream, {
        "content-length": String(size),
      });

      expect(answer.status).toBe(status);
      expect((await apiError(answer)).code).toBe(code);
      expect(body.pulled).toBe(false);
      expect(t.events).toEqual([]);
      expect(await t.staged()).toEqual([]);
    });

    it("refuses an upload to an offline printer", async () => {
      const t = await withPrinter();
      t.drivers
        .latest(t.id)
        .emit({ type: "status", status: "offline", detail: null, error: null });
      await vi.waitFor(() => {
        expect(t.store.get(t.id)?.state.status).toBe("offline");
      });
      const body = watchedBody(10);

      const answer = await t.upload("a.gcode", body.stream, {
        "content-length": "10",
      });

      expect(answer.status).toBe(409);
      expect((await apiError(answer)).code).toBe("printer_offline");
      expect(body.pulled).toBe(false);
    });

    it("refuses an upload to an unknown printer", async () => {
      const t = await withPrinter();
      const body = watchedBody(10);

      const answer = await t.call("PUT", "/api/printers/nope/files/a.gcode", {
        token: t.token,
        body: body.stream,
        headers: { "content-length": "10" },
      });

      expect(answer.status).toBe(404);
      expect(body.pulled).toBe(false);
    });

    it("refuses an upload without a session", async () => {
      const t = await withPrinter();
      const body = watchedBody(10);

      const answer = await t.call(
        "PUT",
        `/api/printers/${t.id}/files/a.gcode`,
        {
          body: body.stream,
          headers: { "content-length": "10" },
        },
      );

      expect(answer.status).toBe(401);
      expect(body.pulled).toBe(false);
    });

    it.each([
      ["no Content-Length", {}],
      [
        "chunked encoding",
        { "content-length": "10", "transfer-encoding": "chunked" },
      ],
      ["a Content-Length that isn't a number", { "content-length": "ten" }],
    ])("answers %s with 411", async (_, headers) => {
      const t = await withPrinter();
      const body = watchedBody(10);

      const answer = await t.upload("a.gcode", body.stream, headers);

      expect(answer.status).toBe(411);
      expect(await apiError(answer)).toEqual({
        code: "length_required",
        message:
          "Send the file with a Content-Length giving its size in bytes; chunked uploads aren't accepted.",
      });
      expect(body.pulled).toBe(false);
    });
  });

  describe("file names", () => {
    it.each([
      ["a slash", "a%2Fb.gcode"],
      ["a backslash", "a%5Cb.gcode"],
      ["a control character", "a%07.gcode"],
      ["256 bytes", encodeURIComponent(`${"é".repeat(124)}xx.gcode`)],
    ])("refuses %s with 400", async (_, name) => {
      const t = await withPrinter();
      const body = watchedBody(4);

      const answer = await t.upload(name, body.stream, {
        "content-length": "4",
      });

      expect(answer.status, await answer.clone().text()).toBe(400);
      expect(await apiError(answer)).toMatchObject({
        code: "validation_failed",
        details: [{ path: ["fileName"] }],
      });
      expect(body.pulled).toBe(false);
    });

    it("takes 255 bytes", async () => {
      const t = await withPrinter();
      const name = `${"é".repeat(124)}x.gcode`;
      expect(Buffer.byteLength(name)).toBe(255);

      const answer = await t.upload(encodeURIComponent(name), "G28\n");

      expect(answer.status).toBe(200);
    });

    it.each([".", ".."])(
      "refuses %j, which URLs can't even carry",
      async (name) => {
        expect(FileName.safeParse(name).error?.issues).toMatchObject([
          { message: "Must not be . or .." },
        ]);
        // The URL parser removes dot segments, so neither reaches the route.
        const t = await withPrinter();
        const answer = await t.upload(name, "G28\n");
        expect(answer.status).toBe(404);
        expect(t.drivers.latest(t.id).ops()).not.toContain("sendFile");
      },
    );

    it.each([
      ["empty", "", "Must not be empty."],
      ["a slash", "a/b", "Must not contain / or \\."],
      ["a backslash", "a\\b", "Must not contain / or \\."],
      ["a NUL", "a\u0000b", "Must not contain control characters."],
      ["DEL", "a\u007fb", "Must not contain control characters."],
      ["256 bytes", "x".repeat(256), "Must be at most 255 bytes in UTF-8."],
    ])("says why a name with %s is refused", (_, name, message) => {
      expect(FileName.safeParse(name).error?.issues).toMatchObject([
        { message },
      ]);
    });
  });

  it("answers a body shorter than its Content-Length with 400 upload_incomplete", async () => {
    const t = await withPrinter();

    const answer = await t.upload("a.gcode", "G28\n", {
      "content-length": "10",
    });

    expect(answer.status).toBe(400);
    expect(await apiError(answer)).toEqual({
      code: "upload_incomplete",
      message: "The upload ended after 4 of 10 bytes.",
    });
    expect(t.events).toEqual([]);
    expect(await t.staged()).toEqual([]);
  });

  it("answers a body longer than its Content-Length with 400 upload_incomplete", async () => {
    const t = await withPrinter();

    const answer = await t.upload("a.gcode", "G28\nG28\n", {
      "content-length": "4",
    });

    expect(answer.status).toBe(400);
    expect((await apiError(answer)).code).toBe("upload_incomplete");
    expect(await t.staged()).toEqual([]);
  });

  it("isn't held to the 64 KiB JSON limit (the real simulator)", async () => {
    const t = await withPrinter("simulated");
    const content = new Uint8Array(JSON_BODY_LIMIT * 3).fill(0x3b); // ";"

    const answer = await t.upload("big.gcode", content);

    expect(answer.status).toBe(200);
    const listed = await t.call("GET", `/api/printers/${t.id}/files`, {
      token: t.token,
    });
    expect(await listed.json()).toEqual({
      files: [
        {
          name: "big.gcode",
          sizeBytes: JSON_BODY_LIMIT * 3,
          modifiedAt: expect.any(String) as unknown,
        },
      ],
    });
    expect(await t.staged()).toEqual([]);
  });
});

describe("GET /api/printers/{id}/files", () => {
  it("answers the driver's list", async () => {
    const t = await withPrinter();
    const files: ListFilesResult["files"] = [
      {
        name: "a.gcode",
        sizeBytes: 10,
        modifiedAt: "2026-10-06T12:00:00.000Z",
      },
    ];
    t.drivers.latest(t.id).handle("listFiles", () => ({ files }));

    const answer = await t.call("GET", `/api/printers/${t.id}/files`, {
      token: t.token,
    });

    expect(answer.status).toBe(200);
    expect(await answer.json()).toEqual({ files });
  });

  it("maps the driver's errors like commands", async () => {
    const t = await withPrinter();
    t.drivers.latest(t.id).handle("listFiles", () => {
      throw new DriverError("offline", "The printer is unreachable.");
    });

    const answer = await t.call("GET", `/api/printers/${t.id}/files`, {
      token: t.token,
    });

    expect(answer.status).toBe(409);
    expect(await apiError(answer)).toEqual({
      code: "printer_offline",
      message: "The printer is unreachable.",
    });
  });

  it("answers an unknown printer with 404", async () => {
    const t = await withPrinter();

    const answer = await t.call("GET", "/api/printers/nope/files", {
      token: t.token,
    });

    expect(answer.status).toBe(404);
    expect((await apiError(answer)).code).toBe("printer_not_found");
  });
});
