// SPDX-FileCopyrightText: 2026 Open Print Stack contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { hasActiveJob } from "@openprintstack/protocol";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";

import { errorMessage } from "../api/errors.ts";
import { usePrinter } from "../realtime/provider.tsx";
import {
  configQuery,
  driverTypesQuery,
  type PrinterConfig,
  useApi,
} from "./api.ts";
import { PrinterForm, type PrinterFormOutput } from "./printer-form.tsx";
import { PageFrame } from "./printer-page.tsx";

// Editing a printer: its name and its stored settings (the type can't
// change). Only what changed is sent; a rename applies at once, and changed
// settings restart the driver, which the server refuses during a job, so
// they're locked while the printer has one.

export const SETTINGS_LOCKED =
  "Settings can't change during a job. You can still rename the printer.";

export function EditPrinterPage({ printerId }: { printerId: string }) {
  const api = useApi();
  const config = useQuery(configQuery(api, printerId));
  const driverTypes = useQuery(driverTypesQuery(api));
  const live = usePrinter(printerId);
  const status = live?.state.status;

  const title = config.data === undefined ? "Edit" : `Edit ${config.data.name}`;
  return (
    <PageFrame>
      <h1 className="font-heading text-xl font-semibold">{title}</h1>
      {config.isPending || driverTypes.isPending ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : config.isError || driverTypes.isError ? (
        <p role="alert" className="text-sm text-destructive">
          Couldn't load the printer:{" "}
          {errorMessage(config.error ?? driverTypes.error)}
        </p>
      ) : (
        <div className="max-w-xl">
          <EditForm
            config={config.data}
            driverTypes={driverTypes.data.driverTypes.filter(
              (each) => each.type === config.data.driverType,
            )}
            settingsLocked={
              status !== undefined && hasActiveJob(status)
                ? SETTINGS_LOCKED
                : undefined
            }
          />
        </div>
      )}
    </PageFrame>
  );
}

function EditForm({
  config,
  driverTypes,
  settingsLocked,
}: {
  config: PrinterConfig;
  driverTypes: Parameters<typeof PrinterForm>[0]["driverTypes"];
  settingsLocked: string | undefined;
}) {
  const api = useApi();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const back = () =>
    navigate({ to: "/printers/$printerId", params: { printerId: config.id } });

  return (
    <PrinterForm
      driverTypes={driverTypes}
      canChooseType={false}
      initial={{
        name: config.name,
        driverType: config.driverType,
        settings: config.settings,
      }}
      settingsLocked={settingsLocked}
      submitLabel="Save"
      onSubmit={async (output) => {
        const body = changes(config, output, settingsLocked === undefined);
        if (body.name === undefined && body.settings === undefined) {
          await back();
          return undefined;
        }
        try {
          const { data, error } = await api.client.PATCH("/api/printers/{id}", {
            params: { path: { id: config.id } },
            body,
          });
          if (error !== undefined) return error;
          queryClient.setQueryData(configQuery(api, config.id).queryKey, data);
          await back();
          return undefined;
        } catch (error) {
          return error;
        }
      }}
    />
  );
}

/**
 * What to send: the name if it changed, and the settings that changed (the
 * server merges them into the stored ones), unless settings are locked.
 */
export function changes(
  config: Pick<PrinterConfig, "name" | "settings">,
  output: PrinterFormOutput,
  settingsEditable: boolean,
): { name?: string; settings?: PrinterFormOutput["settings"] } {
  const changedSettings = Object.entries(output.settings).filter(
    ([key, value]) => config.settings[key] !== value,
  );
  return {
    ...(output.name !== config.name && { name: output.name }),
    ...(settingsEditable &&
      changedSettings.length > 0 && {
        settings: Object.fromEntries(changedSettings),
      }),
  };
}
