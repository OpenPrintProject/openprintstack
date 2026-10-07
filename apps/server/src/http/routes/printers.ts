// SPDX-FileCopyrightText: 2026 Open Print Stack contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { createRoute } from "@hono/zod-openapi";
import {
  settingsJsonSchema,
  defaultSettings,
} from "@openprintstack/driver-sdk";
import {
  IsoDateTime,
  JsonValue,
  PrinterName,
  PrinterSnapshot,
} from "@openprintstack/protocol";
import { z } from "zod";

import type { Printer } from "../../db/repos/index.ts";
import { PrinterServiceError } from "../../printers/printer-service.ts";
import { asJson } from "../errors.ts";
import { requireSession } from "../middleware/session.ts";
import {
  errorResponses,
  jsonBody,
  jsonResponse,
  PrinterIdParams,
  SESSION_SECURITY,
} from "../schemas.ts";
import { newRoutes } from "../validation.ts";

// The driver types, and printers: their live snapshots (from the state store)
// and their stored config (from the printers table, settings included).

const SettingsInput = z.record(z.string(), JsonValue).meta({
  description:
    "Settings fields, checked against the driver type's settings schema.",
});

const DriverType = z
  .object({
    type: z.string(),
    name: z.string(),
    description: z.string(),
    settingsSchema: z.record(z.string(), JsonValue).meta({
      description:
        "The settings' JSON Schema (draft 2020-12), describing the input: fields with a default are optional and carry it.",
    }),
    defaults: z.record(z.string(), JsonValue).meta({
      description: "The default of each settings field that has one.",
    }),
  })
  .meta({ id: "DriverType" });

const PrinterConfig = z
  .object({
    id: z.string(),
    name: z.string(),
    driverType: z.string(),
    settings: z.record(
      z.string(),
      z.union([z.string(), z.number(), z.boolean()]),
    ),
    settingsVersion: z.int().positive(),
    createdAt: IsoDateTime,
    updatedAt: IsoDateTime,
  })
  .meta({
    id: "PrinterConfig",
    description:
      "A printer's stored config. Settings are stored with every default filled in.",
  });

const NewPrinterRequest = z
  .object({
    name: PrinterName,
    driverType: z.string().min(1),
    settings: SettingsInput.optional(),
  })
  .meta({ id: "NewPrinterRequest" });

const PrinterUpdateRequest = z
  .object({
    name: PrinterName.optional(),
    settings: SettingsInput.optional().meta({
      description:
        "Fields to change; the rest keep their stored values. Changing settings restarts the driver, and is refused (409 job_active) while a job is active.",
    }),
  })
  .refine(
    (update) => update.name !== undefined || update.settings !== undefined,
    { error: "Give a name, settings or both." },
  )
  .meta({ id: "PrinterUpdateRequest" });

const authed = {
  security: SESSION_SECURITY,
  middleware: requireSession,
};

const listDriverTypes = createRoute({
  method: "get",
  path: "/api/driver-types",
  operationId: "listDriverTypes",
  tags: ["printers"],
  summary: "The driver types printers can be added with",
  ...authed,
  responses: {
    200: jsonResponse(
      z.object({ driverTypes: z.array(DriverType) }),
      "Each driver type, with its settings form.",
    ),
    ...errorResponses(401),
  },
});

const listPrinters = createRoute({
  method: "get",
  path: "/api/printers",
  operationId: "listPrinters",
  tags: ["printers"],
  summary: "Every printer's live snapshot",
  ...authed,
  responses: {
    200: jsonResponse(
      z.object({ printers: z.array(PrinterSnapshot) }),
      "Every printer, by name.",
    ),
    ...errorResponses(401),
  },
});

const getPrinter = createRoute({
  method: "get",
  path: "/api/printers/{id}",
  operationId: "getPrinter",
  tags: ["printers"],
  summary: "A printer's live snapshot",
  ...authed,
  request: { params: PrinterIdParams },
  responses: {
    200: jsonResponse(PrinterSnapshot, "The printer."),
    ...errorResponses(400, 401, 404),
  },
});

const getPrinterConfig = createRoute({
  method: "get",
  path: "/api/printers/{id}/config",
  operationId: "getPrinterConfig",
  tags: ["printers"],
  summary: "A printer's stored config, settings included",
  ...authed,
  request: { params: PrinterIdParams },
  responses: {
    200: jsonResponse(PrinterConfig, "The printer's config."),
    ...errorResponses(400, 401, 404),
  },
});

const addPrinter = createRoute({
  method: "post",
  path: "/api/printers",
  operationId: "addPrinter",
  tags: ["printers"],
  summary: "Add a printer",
  description:
    "Settings left out take their defaults. Starts the driver and answers after its first connect attempt. Publishes printer.added.",
  ...authed,
  request: { body: jsonBody(NewPrinterRequest) },
  responses: {
    201: jsonResponse(PrinterConfig, "The new printer."),
    ...errorResponses(400, 401, 409, 413, 415, 422),
  },
});

const updatePrinter = createRoute({
  method: "patch",
  path: "/api/printers/{id}",
  operationId: "updatePrinter",
  tags: ["printers"],
  summary: "Rename a printer and/or change its settings",
  description:
    "A rename applies at once. Changed settings restart the driver, answering after its first connect attempt. Publishes printer.updated when anything changed.",
  ...authed,
  request: { params: PrinterIdParams, body: jsonBody(PrinterUpdateRequest) },
  responses: {
    200: jsonResponse(PrinterConfig, "The printer's config."),
    ...errorResponses(400, 401, 404, 409, 413, 415, 422),
  },
});

const deletePrinter = createRoute({
  method: "delete",
  path: "/api/printers/{id}",
  operationId: "deletePrinter",
  tags: ["printers"],
  summary: "Delete a printer",
  description:
    "Stops its driver and deletes its files on the server; allowed during a job. Its events are kept. Publishes printer.removed.",
  ...authed,
  request: { params: PrinterIdParams },
  responses: {
    204: { description: "Deleted." },
    ...errorResponses(400, 401, 404),
  },
});

export function printerRoutes() {
  const routes = newRoutes();

  routes.openapi(listDriverTypes, async (c) => {
    const { deps } = c.var;
    const log = deps.logger.child({ component: "http" });
    const driverTypes: z.infer<typeof DriverType>[] = [];
    for (const type of deps.registry.types()) {
      try {
        const module = await deps.registry.load(type);
        driverTypes.push({
          type,
          name: module.manifest.name,
          description: module.manifest.description,
          settingsSchema: asJson(settingsJsonSchema(module)) as Record<
            string,
            JsonValue
          >,
          defaults: asJson(defaultSettings(module)) as Record<
            string,
            JsonValue
          >,
        });
      } catch (error) {
        // One broken driver package mustn't hide the others.
        log.error(
          { err: error, driverType: type },
          "A driver type couldn't load",
        );
      }
    }
    return c.json({ driverTypes }, 200);
  });

  routes.openapi(listPrinters, (c) => {
    const { deps } = c.var;
    // In the table's order (by name); every printer has a snapshot, because
    // `connecting` is published before its driver starts.
    const printers = deps.repos.printers
      .list()
      .flatMap((printer) => deps.store.get(printer.id) ?? []);
    return c.json({ printers }, 200);
  });

  routes.openapi(getPrinter, (c) => {
    const { id } = c.req.valid("param");
    const snapshot = c.var.deps.store.get(id);
    if (snapshot === undefined) throw printerNotFound(id);
    return c.json(snapshot, 200);
  });

  routes.openapi(getPrinterConfig, (c) => {
    const { id } = c.req.valid("param");
    const printer = c.var.deps.repos.printers.findById(id);
    if (printer === undefined) throw printerNotFound(id);
    return c.json(toConfig(printer), 200);
  });

  routes.openapi(addPrinter, async (c) => {
    const { deps, user } = c.var;
    const { name, driverType, settings } = c.req.valid("json");
    const printer = await deps.printers.add({
      name,
      driverType,
      settings: settings ?? {},
      userId: user.id,
    });
    return c.json(toConfig(printer), 201);
  });

  routes.openapi(updatePrinter, async (c) => {
    const { deps, user } = c.var;
    const { id } = c.req.valid("param");
    const { name, settings } = c.req.valid("json");
    let merged: Record<string, unknown> | undefined;
    if (settings !== undefined) {
      const stored = deps.repos.printers.findById(id);
      if (stored === undefined) throw printerNotFound(id);
      merged = { ...stored.settings, ...settings };
    }
    const printer = await deps.printers.update(
      id,
      {
        ...(name !== undefined && { name }),
        ...(merged !== undefined && { settings: merged }),
      },
      user.id,
    );
    return c.json(toConfig(printer), 200);
  });

  routes.openapi(deletePrinter, async (c) => {
    const { deps, user } = c.var;
    const { id } = c.req.valid("param");
    await deps.printers.remove(id, user.id);
    return c.body(null, 204);
  });

  return routes;
}

function toConfig(printer: Printer): z.infer<typeof PrinterConfig> {
  return {
    id: printer.id,
    name: printer.name,
    driverType: printer.driverType,
    settings: printer.settings,
    settingsVersion: printer.settingsVersion,
    createdAt: new Date(printer.createdAt).toISOString(),
    updatedAt: new Date(printer.updatedAt).toISOString(),
  };
}

export function printerNotFound(printerId: string): PrinterServiceError {
  return new PrinterServiceError(
    "printer_not_found",
    `There is no printer ${printerId}.`,
  );
}
