// SPDX-FileCopyrightText: 2026 Open Print Stack contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";

import { errorMessage } from "../api/errors.ts";
import { Button } from "../components/ui/button.tsx";
import { driverTypesQuery, useApi } from "./api.ts";
import { PrinterForm } from "./printer-form.tsx";
import { PageFrame } from "./printer-page.tsx";

// Adding a printer: its name, its type, and the type's settings, which start
// at their defaults. The server answers after the driver's first attempt to
// connect; the new printer's page then shows it connecting, then live.

export function AddPrinterPage() {
  const api = useApi();
  const navigate = useNavigate();
  const driverTypes = useQuery(driverTypesQuery(api));

  return (
    <PageFrame>
      <h1 className="font-heading text-xl font-semibold">Add a printer</h1>
      {driverTypes.isPending ? (
        <p className="text-sm text-muted-foreground">Loading printer types…</p>
      ) : driverTypes.isError ? (
        <div className="flex flex-col items-start gap-2">
          <p role="alert" className="text-sm text-destructive">
            Couldn't load the printer types: {errorMessage(driverTypes.error)}
          </p>
          <Button
            variant="outline"
            onClick={() => {
              void driverTypes.refetch();
            }}
          >
            Try again
          </Button>
        </div>
      ) : driverTypes.data.driverTypes.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No printer types are available.
        </p>
      ) : (
        <div className="max-w-xl">
          <PrinterForm
            driverTypes={driverTypes.data.driverTypes}
            canChooseType
            initial={{
              name: "",
              driverType: driverTypes.data.driverTypes[0]?.type ?? "",
            }}
            submitLabel="Add printer"
            onSubmit={async ({ name, driverType, settings }) => {
              try {
                const { data, error } = await api.client.POST("/api/printers", {
                  body: { name, driverType, settings },
                });
                if (error !== undefined) return error;
                await navigate({
                  to: "/printers/$printerId",
                  params: { printerId: data.id },
                });
                return undefined;
              } catch (error) {
                return error;
              }
            }}
          />
        </div>
      )}
    </PageFrame>
  );
}
