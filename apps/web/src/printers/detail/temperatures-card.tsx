// SPDX-FileCopyrightText: 2026 Open Print Stack contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { Heater, PrinterSnapshot } from "@openprintstack/protocol";
import { z } from "zod";

import { useAppForm, validationLogic } from "../../components/form.tsx";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "../../components/ui/card.tsx";
import { FieldError } from "../../components/ui/field.tsx";
import { Input } from "../../components/ui/input.tsx";
import { useCommand, useCommandLock } from "../api.ts";
import { commandGate, type Gate, withLock } from "../gating.ts";
import { temperatureText } from "../parts.tsx";
import { GatedButton, GateHint } from "./controls.tsx";

// Each heater's actual and target temperature, and, if the printer can set
// them, a target field capped at the heater's maxC (checked here before
// sending, as the server's safety check does) with Set and Off (0 °C).

export function TemperaturesCard({ snapshot }: { snapshot: PrinterSnapshot }) {
  const { printer, state } = snapshot;
  const locked = useCommandLock(printer.id);
  const heaters = state.capabilities?.heaters ?? [];
  if (heaters.length === 0) return null;
  const gate = commandGate(state, "temperature.set");
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2>Temperatures</h2>
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <ul className="flex flex-col gap-3">
          {heaters.map((heater) => (
            <HeaterRow
              key={heater.id}
              printerId={printer.id}
              heater={heater}
              reading={temperatureText(state.telemetry.temperatures[heater.id])}
              gate={withLock(gate, locked)}
            />
          ))}
        </ul>
        <GateHint gate={gate} />
      </CardContent>
    </Card>
  );
}

/** A target in °C: 0 (off) up to the heater's maxC. */
export function targetSchema(maxC: number) {
  return z.object({
    target: z.string().transform((text, ctx) => {
      const trimmed = text.trim();
      const value = Number(trimmed);
      if (trimmed === "" || !Number.isFinite(value)) {
        ctx.addIssue({ code: "custom", message: "Enter a temperature." });
        return z.NEVER;
      }
      if (!(value >= 0)) {
        ctx.addIssue({ code: "custom", message: "Must be at least 0 °C." });
      }
      if (!(value <= maxC)) {
        ctx.addIssue({
          code: "custom",
          message: `Must be at most ${maxC} °C.`,
        });
      }
      return value;
    }),
  });
}

function HeaterRow({
  printerId,
  heater,
  reading,
  gate,
}: {
  printerId: string;
  heater: Heater;
  reading: string;
  gate: Gate;
}) {
  const command = useCommand(printerId, (sent) =>
    sent.kind === "temperature.set" && sent.targetC === 0
      ? `Couldn't turn the ${heater.label} off`
      : `Couldn't set the ${heater.label}'s temperature`,
  );
  const schema = targetSchema(heater.maxC);
  const form = useAppForm({
    defaultValues: { target: "" },
    validationLogic,
    validators: { onDynamic: schema },
    onSubmit: ({ value }) => {
      const { target } = schema.parse(value);
      command.run({
        kind: "temperature.set",
        heaterId: heater.id,
        targetC: target,
      });
    },
  });
  const inputId = `target-${heater.id}`;

  return (
    <li className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between gap-2 text-sm">
        <span className="font-medium">{heater.label}</span>
        <span className="tabular-nums">{reading}</span>
      </div>
      {gate.shown && (
        <form
          noValidate
          className="flex flex-col gap-1"
          onSubmit={(event) => {
            event.preventDefault();
            void form.handleSubmit();
          }}
        >
          <form.Field name="target">
            {(field) => {
              const invalid =
                field.state.meta.isTouched && !field.state.meta.isValid;
              return (
                <>
                  <div className="flex gap-2">
                    <label htmlFor={inputId} className="sr-only">
                      {heater.label} target (°C)
                    </label>
                    <Input
                      id={inputId}
                      inputMode="decimal"
                      placeholder={`0–${heater.maxC} °C`}
                      disabled={!gate.enabled}
                      value={field.state.value}
                      onBlur={field.handleBlur}
                      onChange={(event) => {
                        field.handleChange(event.target.value);
                      }}
                      aria-invalid={invalid}
                    />
                    <GatedButton
                      type="submit"
                      variant="outline"
                      gate={gate}
                      pending={command.isPending}
                      aria-label={`Set the ${heater.label}`}
                    >
                      Set
                    </GatedButton>
                    <GatedButton
                      type="button"
                      variant="ghost"
                      gate={gate}
                      aria-label={`Turn the ${heater.label} off`}
                      onClick={() => {
                        command.run({
                          kind: "temperature.set",
                          heaterId: heater.id,
                          targetC: 0,
                        });
                      }}
                    >
                      Off
                    </GatedButton>
                  </div>
                  {invalid && <FieldError errors={field.state.meta.errors} />}
                </>
              );
            }}
          </form.Field>
        </form>
      )}
    </li>
  );
}
