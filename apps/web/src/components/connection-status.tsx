// SPDX-FileCopyrightText: 2026 Open Print Stack contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { cn } from "cn";

import type { ConnectionStatus as Status } from "../realtime/client.ts";
import { useConnectionStatus } from "../realtime/provider.tsx";

const LOOK: Record<Status, { label: string; dot: string }> = {
  connecting: { label: "Connecting…", dot: "bg-muted-foreground" },
  live: { label: "Live", dot: "bg-emerald-500" },
  reconnecting: { label: "Reconnecting…", dot: "bg-amber-500" },
  unreachable: { label: "Server unreachable", dot: "bg-destructive" },
  stopped: { label: "Disconnected", dot: "bg-muted-foreground" },
};

/** Whether live updates are arriving: a dot and a word. */
export function ConnectionStatus() {
  const status = useConnectionStatus();
  const { label, dot } = LOOK[status];
  return (
    <span
      role="status"
      className="flex items-center gap-1.5 text-sm text-muted-foreground"
    >
      <span aria-hidden className={cn("size-2 rounded-full", dot)} />
      {label}
    </span>
  );
}
