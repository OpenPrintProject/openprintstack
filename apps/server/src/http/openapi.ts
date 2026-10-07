// SPDX-FileCopyrightText: 2026 Open Print Stack contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import path from "node:path";

import type { OpenAPIHono, RouteConfig } from "@hono/zod-openapi";
import { z } from "zod";

import serverPackage from "../../package.json" with { type: "json" };
import { SESSION_COOKIE } from "../auth/sessions.ts";
import { SERVER_DIR } from "../server-dir.ts";
import { apiRoutes } from "./routes/index.ts";

// The OpenAPI 3.1 document for the REST API, built from the routes that
// @hono/zod-openapi records. Its own generator (zod-to-openapi) loses
// `.nullable()` on schemas with an id and can't handle recursive ones, so the
// schemas are converted here with Zod's own z.toJSONSchema instead: every Zod
// schema of every route in one pass, so each schema with a `.meta({ id })`
// becomes one component that everything refers to.
//
// apps/server/openapi.json is this document, committed; a test fails when it
// differs. Regenerate it with:
//   pnpm --filter @openprintstack/server openapi:emit

export const OPENAPI_PATH = "/api/openapi.json";

/** The committed copy, which the web app's client is generated from. */
export const OPENAPI_FILE = path.join(SERVER_DIR, "openapi.json");

type JsonObject = { [key: string]: unknown };

export type OpenApiDocument = {
  openapi: "3.1.0";
  info: JsonObject;
  paths: Record<string, Record<string, JsonObject>>;
  components: { schemas: Record<string, unknown>; securitySchemes: JsonObject };
};

const METHODS = ["get", "put", "post", "delete", "options", "head", "patch"];

/** Fields of a route config that aren't part of its OpenAPI operation. */
const NOT_OPERATION = new Set(["method", "path", "request", "responses"]);

let cached: OpenApiDocument | undefined;

/** The document for the API's routes, built once. */
export function openApiDocument(): OpenApiDocument {
  cached ??= buildOpenApiDocument(apiRoutes());
  return cached;
}

/** The document as openapi.json holds it. */
export function renderOpenApi(document: OpenApiDocument): string {
  return `${JSON.stringify(document, null, 2)}\n`;
}

/**
 * Builds the document for every route registered on `routes`. Every route
 * needs an operationId, a summary and tags; every schema that's reused or
 * recursive needs an id.
 */
export function buildOpenApiDocument(
  routes: Pick<OpenAPIHono, "openAPIRegistry">,
): OpenApiDocument {
  const configs = routes.openAPIRegistry.definitions.map((definition) => {
    if (definition.type !== "route") {
      throw new Error(`Unexpected OpenAPI definition: ${definition.type}`);
    }
    return definition.route;
  });

  // Every Zod schema goes into one object, converted in one pass.
  const slots: Record<string, z.ZodType> = {};
  const slot = (schema: z.ZodType): string => {
    const key = `s${Object.keys(slots).length}`;
    slots[key] = schema;
    return key;
  };
  const planned = configs.map((route) => plan(route, slot));
  const converted = z.toJSONSchema(z.object(slots), {
    target: "draft-2020-12",
    io: "input",
    unrepresentable: "throw",
    cycles: "ref",
  }) as JsonObject & {
    properties?: Record<string, unknown>;
    $defs?: Record<string, unknown>;
  };
  const definitions = converted.$defs ?? {};
  const anonymous = Object.keys(definitions).filter((name) =>
    name.startsWith("__"),
  );
  if (anonymous.length > 0) {
    throw new Error(
      `Some reused or recursive schemas have no id (${anonymous.join(", ")}); give each a .meta({ id }).`,
    );
  }
  const schemaFor = (key: string): JsonObject =>
    toComponentRefs(converted.properties?.[key]) as JsonObject;

  const paths: OpenApiDocument["paths"] = {};
  for (const { route, params, query, body, responses } of planned) {
    const operation: JsonObject = {};
    for (const [key, value] of Object.entries(route)) {
      if (!NOT_OPERATION.has(key)) operation[key] = value;
    }
    const parameters = [
      ...parametersOf(
        params === undefined ? undefined : schemaFor(params),
        "path",
      ),
      ...parametersOf(
        query === undefined ? undefined : schemaFor(query),
        "query",
      ),
    ];
    if (parameters.length > 0) operation.parameters = parameters;
    if (body !== undefined) {
      operation.requestBody = {
        ...(body.description !== undefined && {
          description: body.description,
        }),
        required: body.required,
        content: contentOf(body.content, schemaFor),
      };
    }
    operation.responses = Object.fromEntries(
      Object.entries(responses).map(([status, response]) => [
        status,
        {
          ...response,
          ...(response.content !== undefined && {
            content: contentOf(response.content, schemaFor),
          }),
        },
      ]),
    );
    const item = (paths[route.path] ??= {});
    if (item[route.method] !== undefined) {
      throw new Error(`${route.method} ${route.path} is defined twice.`);
    }
    item[route.method] = operation;
  }

  return {
    openapi: "3.1.0",
    info: {
      title: "Open Print Stack",
      version: serverPackage.version,
      description:
        "The Open Print Stack server's REST API. Generated from the server's routes; don't edit it by hand. Errors are ApiError bodies whose code says what went wrong.",
      license: { name: "AGPL-3.0-or-later", identifier: "AGPL-3.0-or-later" },
    },
    paths: sortPaths(paths),
    components: {
      schemas: Object.fromEntries(
        Object.keys(definitions)
          .sort()
          .map((name) => [name, toComponentRefs(definitions[name])]),
      ),
      securitySchemes: {
        session: {
          type: "apiKey",
          in: "cookie",
          name: SESSION_COOKIE,
          description:
            "The session cookie that setup and login set: HttpOnly, SameSite=Lax, 7 days from the last request.",
        },
      },
    },
  };
}

type Content = Record<string, { schema?: unknown; [key: string]: unknown }>;

type Planned = {
  route: RouteConfig;
  params: string | undefined;
  query: string | undefined;
  body:
    | { required: boolean; description: string | undefined; content: Content }
    | undefined;
  responses: Record<string, { content?: Content; [key: string]: unknown }>;
};

/** Gives each of the route's Zod schemas a slot, keeping everything else. */
function plan(
  route: RouteConfig,
  slot: (schema: z.ZodType) => string,
): Planned {
  if (!METHODS.includes(route.method)) {
    throw new Error(`Unexpected method ${route.method} for ${route.path}`);
  }
  for (const field of ["operationId", "summary", "tags"] as const) {
    if (route[field] === undefined) {
      throw new Error(`${route.method} ${route.path} has no ${field}.`);
    }
  }
  const request = route.request ?? {};
  if (request.headers !== undefined || request.cookies !== undefined) {
    throw new Error(
      `${route.method} ${route.path}: header and cookie parameters aren't supported.`,
    );
  }
  const slotted = (content: Record<string, unknown> | undefined): Content =>
    Object.fromEntries(
      Object.entries(content ?? {}).map(([type, media]) => {
        const { schema, ...rest } = media as { schema?: unknown };
        return [
          type,
          {
            ...rest,
            ...(schema !== undefined && {
              schema: schema instanceof z.ZodType ? slot(schema) : schema,
            }),
          },
        ];
      }),
    );
  return {
    route,
    params: request.params && slot(request.params),
    query: request.query && slot(request.query),
    body: request.body && {
      required: request.body.required ?? false,
      description: request.body.description,
      content: slotted(request.body.content),
    },
    responses: Object.fromEntries(
      Object.entries(route.responses).map(([status, response]) => {
        if ("$ref" in response) {
          throw new Error(
            `${route.method} ${route.path}: $ref responses aren't supported.`,
          );
        }
        const { content, ...rest } = response as {
          content?: Record<string, unknown>;
        };
        return [
          status,
          {
            ...rest,
            ...(content !== undefined && { content: slotted(content) }),
          },
        ];
      }),
    ),
  };
}

/** The media types, with each slotted schema replaced by its JSON Schema. */
function contentOf(
  content: Content,
  schemaFor: (key: string) => JsonObject,
): Content {
  return Object.fromEntries(
    Object.entries(content).map(([type, media]) => [
      type,
      {
        ...media,
        ...(typeof media.schema === "string" && {
          schema: schemaFor(media.schema),
        }),
      },
    ]),
  );
}

/** One parameter per property of an object's JSON Schema. */
function parametersOf(
  schema: JsonObject | undefined,
  location: "path" | "query",
): JsonObject[] {
  if (schema === undefined) return [];
  const properties = (schema.properties ?? {}) as Record<string, JsonObject>;
  const required = new Set((schema.required ?? []) as string[]);
  return Object.entries(properties).map(([name, property]) => {
    const { description, ...rest } = property;
    return {
      name,
      in: location,
      required: location === "path" || required.has(name),
      ...(description !== undefined && { description }),
      schema: rest,
    };
  });
}

/** Zod's refs point into $defs; the document's point into components. */
function toComponentRefs(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(toComponentRefs);
  if (typeof node !== "object" || node === null) return node;
  return Object.fromEntries(
    Object.entries(node).map(([key, value]) => [
      key,
      key === "$ref" && typeof value === "string"
        ? value.replace(/^#\/\$defs\//, "#/components/schemas/")
        : toComponentRefs(value),
    ]),
  );
}

/** Paths sorted, so the file reads in order and diffs stay small. */
function sortPaths(paths: OpenApiDocument["paths"]): OpenApiDocument["paths"] {
  return Object.fromEntries(
    Object.keys(paths)
      .sort()
      .map((key) => [key, paths[key]!]),
  );
}
