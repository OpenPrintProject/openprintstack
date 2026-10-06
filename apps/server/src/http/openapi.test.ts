// SPDX-FileCopyrightText: 2026 Open Print Stack contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { readFile } from "node:fs/promises";

import { createRoute, OpenAPIHono } from "@hono/zod-openapi";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import serverPackage from "../../package.json" with { type: "json" };
import {
  buildOpenApiDocument,
  OPENAPI_FILE,
  OPENAPI_PATH,
  openApiDocument,
  renderOpenApi,
} from "./openapi.ts";
import { testApp } from "./test-app.ts";

type Operation = {
  operationId?: string;
  summary?: string;
  tags?: string[];
  security?: unknown[];
  parameters?: { name: string; in: string }[];
  responses: Record<
    string,
    { content?: Record<string, { schema?: { $ref?: string } }> }
  >;
};

/** Every operation in the document, as [method, path, operation]. */
function operations(): [string, string, Operation][] {
  return Object.entries(openApiDocument().paths).flatMap(([path, item]) =>
    Object.entries(item).map(
      ([method, operation]) =>
        [method, path, operation as Operation] as [string, string, Operation],
    ),
  );
}

/** A path with each {param} filled in. */
function concrete(path: string): string {
  return path.replace("{fileName}", "a.gcode").replace(/\{[^}]+\}/g, "x");
}

describe("openapi.json", () => {
  it("matches the routes (no drift)", async () => {
    const committed = await readFile(OPENAPI_FILE, "utf8");

    expect(
      committed,
      "apps/server/openapi.json is out of date: run `pnpm --filter @openprintstack/server openapi:emit` and commit the result.",
    ).toBe(renderOpenApi(openApiDocument()));
  });

  it("is served at /api/openapi.json without a login", async () => {
    const t = await testApp();

    const answer = await t.call("GET", OPENAPI_PATH);

    expect(answer.status).toBe(200);
    expect(await answer.json()).toEqual(openApiDocument());
    expect(answer.headers.get("x-content-type-options")).toBe("nosniff");
  });

  it("documents every route the app serves, and serves every one it documents", async () => {
    const t = await testApp();

    const served = t.app.routes
      .filter((route) => route.method !== "ALL" && route.path !== OPENAPI_PATH)
      .map(
        (route) => `${route.method} ${route.path.replace(/:([^/]+)/g, "{$1}")}`,
      )
      .sort();
    const documented = operations()
      .map(([method, path]) => `${method.toUpperCase()} ${path}`)
      .sort();

    expect(documented).toEqual([...new Set(served)]);
    expect(documented).toEqual([
      "DELETE /api/printers/{id}",
      "GET /api/auth/me",
      "GET /api/driver-types",
      "GET /api/events",
      "GET /api/printers",
      "GET /api/printers/{id}",
      "GET /api/printers/{id}/cameras",
      "GET /api/printers/{id}/cameras/{cameraId}/snapshot",
      "GET /api/printers/{id}/config",
      "GET /api/printers/{id}/files",
      "PATCH /api/printers/{id}",
      "POST /api/auth/login",
      "POST /api/auth/logout",
      "POST /api/auth/setup",
      "POST /api/printers",
      "POST /api/printers/{id}/commands",
      "POST /api/printers/{id}/simulator/clear",
      "POST /api/printers/{id}/simulator/faults/disconnect",
      "POST /api/printers/{id}/simulator/faults/error",
      "POST /api/printers/{id}/simulator/faults/filament-runout",
      "POST /api/printers/{id}/simulator/speed",
      "PUT /api/printers/{id}/files/{fileName}",
    ]);
  });

  it("is OpenAPI 3.1 with the server's version", () => {
    const document = openApiDocument();

    expect(document.openapi).toBe("3.1.0");
    expect(document.info).toMatchObject({
      title: "Open Print Stack",
      version: serverPackage.version,
    });
    expect(document.components.securitySchemes).toEqual({
      session: expect.objectContaining({
        type: "apiKey",
        in: "cookie",
        name: "ops_session",
      }) as unknown,
    });
  });

  it("gives each operation a unique id, a summary and tags", () => {
    const all = operations();

    for (const [method, path, operation] of all) {
      expect(operation.summary, `${method} ${path}`).toBeTruthy();
      expect(operation.tags, `${method} ${path}`).toHaveLength(1);
    }
    const ids = all.map(([, , operation]) => operation.operationId);
    expect(new Set(ids).size).toBe(all.length);
  });

  it("answers every error with an ApiError", () => {
    for (const [method, path, operation] of operations()) {
      for (const [status, response] of Object.entries(operation.responses)) {
        if (Number(status) < 400) continue;
        expect(
          response.content?.["application/json"]?.schema,
          `${method} ${path} ${status}`,
        ).toEqual({ $ref: "#/components/schemas/ApiError" });
      }
    }
  });

  describe("security", () => {
    const PUBLIC = [
      "POST /api/auth/login",
      "POST /api/auth/logout",
      "POST /api/auth/setup",
    ];

    it("marks every route except setup, login and logout as needing the session", () => {
      const open = operations()
        .filter(([, , operation]) => operation.security === undefined)
        .map(([method, path]) => `${method.toUpperCase()} ${path}`)
        .sort();

      expect(open).toEqual(PUBLIC);
      for (const [, , operation] of operations()) {
        if (operation.security !== undefined) {
          expect(operation.security).toEqual([{ session: [] }]);
          expect(operation.responses["401"]).toBeDefined();
        }
      }
    });

    it("matches what the app does: each secured route answers 401 without a session", async () => {
      const t = await testApp();
      await t.setupAdmin();

      for (const [method, path, operation] of operations()) {
        const answer = await t.call(method.toUpperCase(), concrete(path), {
          ...(method !== "get" && method !== "delete" && { json: {} }),
        });
        const label = `${method.toUpperCase()} ${path}`;
        if (operation.security === undefined) {
          expect(answer.status, label).not.toBe(401);
        } else {
          expect(answer.status, label).toBe(401);
        }
      }
    });
  });

  describe("schemas", () => {
    const schemas = () =>
      openApiDocument().components.schemas as Record<
        string,
        Record<string, unknown>
      >;

    it("keeps nullable references nullable", () => {
      const { Telemetry, PrinterState } = schemas();
      const nullable = (name: string) => ({
        anyOf: [{ $ref: `#/components/schemas/${name}` }, { type: "null" }],
      });

      expect(Telemetry).toMatchObject({
        properties: {
          position: nullable("Position"),
          job: nullable("JobProgress"),
        },
      });
      expect(PrinterState).toMatchObject({
        properties: {
          error: nullable("ErrorInfo"),
          capabilities: nullable("Capabilities"),
        },
      });
    });

    it("has one JsonValue, used by ApiError.details and extension params", () => {
      const { ApiError, ExtensionInvokeCommand, JsonValue } = schemas();
      const ref = { $ref: "#/components/schemas/JsonValue" };

      expect(ApiError).toMatchObject({
        properties: { error: { properties: { details: ref } } },
      });
      expect(ExtensionInvokeCommand).toMatchObject({
        properties: { params: ref },
      });
      expect(JsonValue).toMatchObject({
        anyOf: expect.arrayContaining([
          { type: "array", items: ref },
        ]) as unknown,
      });
    });

    it("names every component, and every reference resolves", () => {
      const names = Object.keys(schemas());
      const text = JSON.stringify(openApiDocument());
      const refs = new Set(
        [...text.matchAll(/"\$ref":"#\/components\/schemas\/([^"]+)"/g)].map(
          (match) => match[1],
        ),
      );

      expect(names.filter((name) => name.startsWith("__"))).toEqual([]);
      expect([...refs].filter((ref) => !names.includes(ref ?? ""))).toEqual([]);
      expect(text).not.toContain("#/$defs/");
    });

    it("leaves file.upload out of the commands users can send", () => {
      const { UserCommand } = schemas();
      const options = (UserCommand?.oneOf ?? UserCommand?.anyOf) as {
        $ref: string;
      }[];

      expect(options.map((option) => option.$ref)).not.toContain(
        "#/components/schemas/FileUploadCommand",
      );
      expect(options).toHaveLength(9);
    });
  });
});

describe("buildOpenApiDocument", () => {
  it("refuses a route without an operationId", () => {
    const routes = new OpenAPIHono();
    routes.openapi(
      createRoute({
        method: "get",
        path: "/x",
        summary: "X",
        tags: ["x"],
        responses: { 204: { description: "Nothing." } },
      }),
      (c) => c.body(null, 204),
    );

    expect(() => buildOpenApiDocument(routes)).toThrow(
      "get /x has no operationId.",
    );
  });

  it("refuses a recursive schema without an id", () => {
    type Tree = { children: Tree[] };
    const Tree: z.ZodType<Tree> = z.lazy(() =>
      z.object({ children: z.array(Tree) }),
    );
    const routes = new OpenAPIHono();
    routes.openapi(
      createRoute({
        method: "get",
        path: "/tree",
        operationId: "tree",
        summary: "A tree",
        tags: ["x"],
        responses: {
          200: {
            description: "A tree.",
            content: { "application/json": { schema: Tree } },
          },
        },
      }),
      (c) => c.json({ children: [] }, 200),
    );

    expect(() => buildOpenApiDocument(routes)).toThrow(
      /have no id \(__schema0\); give each a \.meta\(\{ id \}\)\./,
    );
  });
});
