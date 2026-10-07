// SPDX-FileCopyrightText: 2026 Open Print Stack contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { ComponentProps, ReactNode } from "react";

import { Button } from "../../components/ui/button.tsx";
import { Spinner } from "../../components/ui/spinner.tsx";
import type { Gate } from "../gating.ts";

// The detail page's controls, gated (gating.ts): hidden when the printer
// can't do it, disabled with the reason when it can't now.

/**
 * A button for a gated control: nothing when hidden; disabled, with the
 * reason as its tooltip, when it can't be used; a spinner while its command
 * runs.
 */
export function GatedButton({
  gate,
  pending = false,
  children,
  ...props
}: {
  gate: Gate;
  pending?: boolean;
  children: ReactNode;
} & Omit<ComponentProps<typeof Button>, "disabled" | "title">) {
  if (!gate.shown) return null;
  return (
    <Button
      {...props}
      disabled={!gate.enabled}
      title={gate.enabled ? undefined : gate.reason}
    >
      {pending && <Spinner data-icon="inline-start" aria-hidden />}
      {children}
    </Button>
  );
}

/** Why a card's controls can't be used now, shown under them. */
export function GateHint({ gate }: { gate: Gate }) {
  if (!gate.shown || gate.enabled) return null;
  return <p className="text-sm text-muted-foreground">{gate.reason}</p>;
}
