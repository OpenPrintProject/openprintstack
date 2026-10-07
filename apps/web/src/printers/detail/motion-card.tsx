// SPDX-FileCopyrightText: 2026 Open Print Stack contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { Axis, PrinterSnapshot } from "@openprintstack/protocol";
import { useState } from "react";

import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "../../components/ui/card.tsx";
import {
  ToggleGroup,
  ToggleGroupItem,
} from "../../components/ui/toggle-group.tsx";
import { type UserCommand, useCommand, useCommandLock } from "../api.ts";
import { formatMm } from "../format.ts";
import { commandGate, type Gate, jogGate, withLock } from "../gating.ts";
import { GatedButton, GateHint } from "./controls.tsx";

// The toolhead's position, Home (all, or one axis), and jogs: relative moves
// of a chosen step, at the printer's own speed. Jogs wait until their axis is
// homed and the position is known, as the server's safety check requires.

/** The jog steps, in mm. */
export const JOG_STEPS = [0.1, 1, 10, 100] as const;

const AXES: readonly Axis[] = ["x", "y", "z"];

export function MotionCard({ snapshot }: { snapshot: PrinterSnapshot }) {
  const { printer, state } = snapshot;
  const locked = useCommandLock(printer.id);
  const [step, setStep] = useState<number>(10);
  const home = useCommand(printer.id, homeFailure);
  const jog = useCommand(printer.id, () => "Couldn't jog");
  const homeGate = commandGate(state, "motion.home");
  const moveGate = commandGate(state, "motion.move");
  if (!homeGate.shown && !moveGate.shown) return null;
  const { position } = state.telemetry;

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2>Motion</h2>
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <dl className="grid grid-cols-3 gap-2 text-sm">
          {AXES.map((axis) => (
            <div key={axis}>
              <dt className="text-muted-foreground">{axis.toUpperCase()}</dt>
              <dd className="tabular-nums">
                {position === null ? "Unknown" : formatMm(position[axis])}
              </dd>
            </div>
          ))}
        </dl>
        {position === null && (
          <p className="text-sm text-muted-foreground">
            The position is unknown until the printer is homed.
          </p>
        )}
        {homeGate.shown && (
          <div className="flex flex-wrap gap-2">
            <GatedButton
              variant="outline"
              gate={withLock(homeGate, locked)}
              pending={home.isPending}
              onClick={() => {
                home.run({ kind: "motion.home", axes: [] });
              }}
            >
              Home all
            </GatedButton>
            {AXES.map((axis) => (
              <GatedButton
                key={axis}
                variant="outline"
                gate={withLock(homeGate, locked)}
                aria-label={`Home ${axis.toUpperCase()}`}
                onClick={() => {
                  home.run({ kind: "motion.home", axes: [axis] });
                }}
              >
                Home {axis.toUpperCase()}
              </GatedButton>
            ))}
          </div>
        )}
        {moveGate.shown && (
          <div className="flex flex-col gap-3">
            <ToggleGroup
              type="single"
              variant="outline"
              aria-label="Jog step"
              value={String(step)}
              onValueChange={(value) => {
                // Choosing the selected step again would leave none.
                if (value !== "") setStep(Number(value));
              }}
            >
              {JOG_STEPS.map((each) => (
                <ToggleGroupItem key={each} value={String(each)}>
                  {each} mm
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
              {AXES.flatMap((axis) =>
                ([-1, 1] as const).map((sign) => {
                  const distance = sign * step;
                  const name = axis.toUpperCase();
                  return (
                    <GatedButton
                      key={`${axis}${sign}`}
                      variant="outline"
                      gate={withLock(jogGate(state, axis), locked)}
                      aria-label={`Move ${name} by ${distance} mm`}
                      onClick={() => {
                        jog.run(jogCommand(axis, distance));
                      }}
                    >
                      {name}
                      {sign < 0 ? "−" : "+"}
                    </GatedButton>
                  );
                }),
              )}
            </div>
          </div>
        )}
        <GateHint gate={homeGate.shown ? homeGate : moveGate} />
        {moveGate.shown &&
          moveGate.enabled &&
          AXES.some((axis) => isRefused(jogGate(state, axis))) && (
            <p className="text-sm text-muted-foreground">
              Jogs need their axis homed and the position known.
            </p>
          )}
      </CardContent>
    </Card>
  );
}

function isRefused(gate: Gate): boolean {
  return gate.shown && !gate.enabled;
}

/** A relative move of `distance` mm along one axis. */
export function jogCommand(axis: Axis, distance: number): UserCommand {
  switch (axis) {
    case "x":
      return { kind: "motion.move", x: distance };
    case "y":
      return { kind: "motion.move", y: distance };
    case "z":
      return { kind: "motion.move", z: distance };
  }
}

function homeFailure(command: UserCommand): string {
  if (command.kind !== "motion.home" || command.axes.length === 0) {
    return "Couldn't home the printer";
  }
  return `Couldn't home ${command.axes.map((axis) => axis.toUpperCase()).join(", ")}`;
}
