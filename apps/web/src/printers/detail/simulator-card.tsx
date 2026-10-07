// SPDX-FileCopyrightText: 2026 Open Print Stack contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { PrinterSnapshot } from "@openprintstack/protocol";
import { z } from "zod";

import { useAppForm, validationLogic } from "../../components/form.tsx";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "../../components/ui/card.tsx";
import { FieldError } from "../../components/ui/field.tsx";
import { Input } from "../../components/ui/input.tsx";
import { toastFailure, useApi, useCommandLock } from "../api.ts";
import { type Gate, simulatorGate, withLock } from "../gating.ts";
import { GatedButton } from "./controls.tsx";

// The simulated printer's faults, for printers with the `simulator`
// extension. Each is an extension.invoke command (the server's simulator
// routes), so it shares the printer's command lock; the server lets the
// simulator decide when each applies, even while offline, so they're never
// disabled by status.

/** An optional error message: up to 500 characters, sent only if given. */
export const ErrorMessage = z.object({
  value: z
    .string()
    .trim()
    .max(500, { error: "Must be at most 500 characters." }),
});

/** How long a simulated disconnect lasts, in seconds. */
export const DisconnectSeconds = z.object({
  value: numberText(1, 3600, "Enter a number of seconds."),
});

/** The simulation's speed multiplier. */
export const SpeedMultiplier = z.object({
  value: numberText(0.1, 1000, "Enter a multiplier."),
});

function numberText(min: number, max: number, empty: string) {
  return z.string().transform((text, ctx) => {
    const trimmed = text.trim();
    const value = Number(trimmed);
    if (trimmed === "" || !Number.isFinite(value)) {
      ctx.addIssue({ code: "custom", message: empty });
      return z.NEVER;
    }
    if (!(value >= min && value <= max)) {
      ctx.addIssue({
        code: "custom",
        message: `Must be from ${min} to ${max}.`,
      });
    }
    return value;
  });
}

export function SimulatorCard({ snapshot }: { snapshot: PrinterSnapshot }) {
  const { printer, state } = snapshot;
  const api = useApi();
  const locked = useCommandLock(printer.id);
  const params = { path: { id: printer.id } };
  const runout = api.query.useMutation(
    "post",
    "/api/printers/{id}/simulator/faults/filament-runout",
    {
      onError: (error) =>
        toastFailure("Couldn't simulate a filament runout", error),
    },
  );
  const fail = api.query.useMutation(
    "post",
    "/api/printers/{id}/simulator/faults/error",
    { onError: (error) => toastFailure("Couldn't simulate an error", error) },
  );
  const disconnect = api.query.useMutation(
    "post",
    "/api/printers/{id}/simulator/faults/disconnect",
    {
      onError: (error) => toastFailure("Couldn't simulate a disconnect", error),
    },
  );
  const clear = api.query.useMutation(
    "post",
    "/api/printers/{id}/simulator/clear",
    {
      onError: (error) =>
        toastFailure("Couldn't clear the simulated faults", error),
    },
  );
  const speed = api.query.useMutation(
    "post",
    "/api/printers/{id}/simulator/speed",
    {
      onError: (error) =>
        toastFailure("Couldn't change the simulation speed", error),
    },
  );
  const gate = simulatorGate(state);
  if (!gate.shown) return null;
  const locking = withLock(gate, locked);

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2>Simulator</h2>
        </CardTitle>
        <CardDescription>
          Faults to try the app with. They act on the simulated printer at once.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="flex flex-wrap gap-2">
          <GatedButton
            variant="outline"
            gate={locking}
            pending={runout.isPending}
            onClick={() => {
              runout.mutate({ params });
            }}
          >
            Filament runout
          </GatedButton>
          <GatedButton
            variant="outline"
            gate={locking}
            pending={clear.isPending}
            onClick={() => {
              clear.mutate({ params });
            }}
          >
            Clear
          </GatedButton>
        </div>
        <ValueForm
          label="Error message (optional)"
          placeholder="Simulated error"
          defaultValue=""
          schema={ErrorMessage}
          button="Simulate an error"
          gate={locking}
          pending={fail.isPending}
          onSubmit={({ value }) => {
            fail.mutate({
              params,
              body: value === "" ? {} : { message: value },
            });
          }}
        />
        <ValueForm
          label="Disconnect for (seconds)"
          defaultValue="15"
          inputMode="decimal"
          schema={DisconnectSeconds}
          button="Disconnect"
          gate={locking}
          pending={disconnect.isPending}
          onSubmit={({ value }) => {
            disconnect.mutate({ params, body: { durationS: value } });
          }}
        />
        <ValueForm
          label="Speed multiplier, until the printer restarts"
          placeholder="0.1–1000"
          defaultValue=""
          inputMode="decimal"
          schema={SpeedMultiplier}
          button="Set speed"
          gate={locking}
          pending={speed.isPending}
          onSubmit={({ value }) => {
            speed.mutate({ params, body: { multiplier: value } });
          }}
        />
      </CardContent>
    </Card>
  );
}

/** A field and a button, sending the field's value once it's valid. */
function ValueForm<T>({
  label,
  placeholder,
  defaultValue,
  inputMode,
  schema,
  button,
  gate,
  pending,
  onSubmit,
}: {
  label: string;
  placeholder?: string;
  defaultValue: string;
  inputMode?: "decimal";
  schema: z.ZodType<{ value: T }, { value: string }>;
  button: string;
  gate: Gate;
  pending: boolean;
  onSubmit: (parsed: { value: T }) => void;
}) {
  const form = useAppForm({
    defaultValues: { value: defaultValue },
    validationLogic,
    validators: { onDynamic: schema },
    onSubmit: ({ value }) => {
      onSubmit(schema.parse(value));
    },
  });
  const id = `simulator-${button.toLowerCase().replaceAll(" ", "-")}`;
  return (
    <form
      noValidate
      className="flex flex-col gap-1.5"
      onSubmit={(event) => {
        event.preventDefault();
        void form.handleSubmit();
      }}
    >
      <label htmlFor={id} className="text-sm font-medium">
        {label}
      </label>
      <form.Field name="value">
        {(field) => {
          const invalid =
            field.state.meta.isTouched && !field.state.meta.isValid;
          return (
            <>
              <div className="flex gap-2">
                <Input
                  id={id}
                  inputMode={inputMode}
                  placeholder={placeholder}
                  disabled={!gate.shown || !gate.enabled}
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
                  pending={pending}
                >
                  {button}
                </GatedButton>
              </div>
              {invalid && <FieldError errors={field.state.meta.errors} />}
            </>
          );
        }}
      </form.Field>
    </form>
  );
}
