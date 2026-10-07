// SPDX-FileCopyrightText: 2026 Open Print Stack contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { Fan, PrinterSnapshot } from "@openprintstack/protocol";
import { useState } from "react";

import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "../../components/ui/card.tsx";
import { Slider } from "../../components/ui/slider.tsx";
import { useCommand, useCommandLock } from "../api.ts";
import { formatPercent } from "../format.ts";
import { commandGate, fanGate, type Gate, withLock } from "../gating.ts";
import { GateHint } from "./controls.tsx";

// Each fan's speed. A fan the printer can set gets a 0–100 % slider that
// sends fan.set once, when it's let go (or on each key press), not while
// dragging; one that only reports its speed is shown read-only.

export function FansCard({ snapshot }: { snapshot: PrinterSnapshot }) {
  const { printer, state } = snapshot;
  const locked = useCommandLock(printer.id);
  const fans = state.capabilities?.fans ?? [];
  if (fans.length === 0) return null;
  const anyControllable = fans.some((fan) => fanGate(state, fan).shown);
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2>Fans</h2>
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <ul className="flex flex-col gap-4">
          {fans.map((fan) => (
            <FanRow
              key={fan.id}
              printerId={printer.id}
              fan={fan}
              percent={state.telemetry.fans[fan.id]?.percent ?? null}
              gate={withLock(fanGate(state, fan), locked)}
            />
          ))}
        </ul>
        {anyControllable && <GateHint gate={commandGate(state, "fan.set")} />}
      </CardContent>
    </Card>
  );
}

function FanRow({
  printerId,
  fan,
  percent,
  gate,
}: {
  printerId: string;
  fan: Fan;
  percent: number | null;
  gate: Gate;
}) {
  const command = useCommand(
    printerId,
    () => `Couldn't set the ${fan.label} fan`,
  );
  // While dragging, and until the command is answered, the slider shows
  // where it was put rather than the printer's reading.
  const [dragged, setDragged] = useState<number>();
  const [sent, setSent] = useState<number>();
  const shown = dragged ?? (command.isPending ? sent : undefined) ?? percent;

  return (
    <li className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between gap-2 text-sm">
        <span className="font-medium">{fan.label}</span>
        <span className="tabular-nums">{formatPercent(shown)}</span>
      </div>
      {gate.shown && (
        <Slider
          thumbLabel={`${fan.label} fan speed`}
          min={0}
          max={100}
          step={1}
          value={[shown ?? 0]}
          disabled={!gate.enabled}
          onValueChange={([value]) => {
            setDragged(value);
          }}
          onValueCommit={([value]) => {
            if (value === undefined) return;
            command.run({ kind: "fan.set", fanId: fan.id, percent: value });
            setSent(value);
            setDragged(undefined);
          }}
        />
      )}
    </li>
  );
}
