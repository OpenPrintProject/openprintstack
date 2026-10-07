// SPDX-FileCopyrightText: 2026 Open Print Stack contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { isOnline, type PrinterSnapshot } from "@openprintstack/protocol";
import { useQuery } from "@tanstack/react-query";
import { RefreshCwIcon } from "lucide-react";
import { useState } from "react";

import { errorMessage } from "../../api/errors.ts";
import { Button } from "../../components/ui/button.tsx";
import {
  Card,
  CardAction,
  CardContent,
  CardHeader,
  CardTitle,
} from "../../components/ui/card.tsx";
import { camerasQuery, snapshotUrl, useApi } from "../api.ts";

// A snapshot from each of the printer's cameras, taken when the page opens
// and again on Refresh. The image is the snapshot route itself; a new
// `version` in its address makes the browser ask again (the server never
// lets it be cached). Cameras are listed only while the printer is online.

let lastVersion = 0;

/** A version no snapshot on the page has used yet. */
function newVersion(): number {
  lastVersion += 1;
  return lastVersion;
}

export function CameraCard({ snapshot }: { snapshot: PrinterSnapshot }) {
  const { printer, state } = snapshot;
  const api = useApi();
  const [version, setVersion] = useState(newVersion);
  const shown = state.capabilities?.cameras.snapshot === true;
  const online = isOnline(state.status);
  const cameras = useQuery({
    ...camerasQuery(api, printer.id),
    enabled: shown && online,
  });
  if (!shown) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2>Camera</h2>
        </CardTitle>
        {online && (
          <CardAction>
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                setVersion(newVersion());
              }}
            >
              <RefreshCwIcon data-icon="inline-start" />
              Refresh
            </Button>
          </CardAction>
        )}
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {!online ? (
          <p className="text-sm text-muted-foreground">
            Snapshots appear when the printer is online.
          </p>
        ) : cameras.isPending ? (
          <p className="text-sm text-muted-foreground">Loading cameras…</p>
        ) : cameras.isError ? (
          <p role="alert" className="text-sm text-destructive">
            Couldn't list the cameras: {errorMessage(cameras.error)}
          </p>
        ) : cameras.data.cameras.length === 0 ? (
          <p className="text-sm text-muted-foreground">No cameras.</p>
        ) : (
          cameras.data.cameras.map((camera) => (
            <Snapshot
              key={camera.id}
              src={snapshotUrl(printer.id, camera.id, version)}
              label={camera.label}
            />
          ))
        )}
      </CardContent>
    </Card>
  );
}

function Snapshot({ src, label }: { src: string; label: string }) {
  // The address that failed to load, so a refresh tries again.
  const [failed, setFailed] = useState<string>();
  return (
    <figure className="flex flex-col gap-2">
      {failed === src ? (
        <p role="alert" className="text-sm text-destructive">
          Couldn't load the snapshot from {label}.
        </p>
      ) : (
        <img
          src={src}
          alt={`Snapshot from ${label}`}
          className="w-full rounded-md border bg-muted"
          onError={() => {
            setFailed(src);
          }}
        />
      )}
      <figcaption className="text-sm text-muted-foreground">{label}</figcaption>
    </figure>
  );
}
