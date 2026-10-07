// SPDX-FileCopyrightText: 2026 Open Print Stack contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { EventType } from "@openprintstack/protocol";
import { ChevronDownIcon } from "lucide-react";
import { useId } from "react";

import { Button } from "../components/ui/button.tsx";
import { Checkbox } from "../components/ui/checkbox.tsx";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "../components/ui/popover.tsx";
import { CATEGORY_LABEL, TYPE_LABEL } from "./describe.ts";
import { TYPE_GROUPS } from "./filters.ts";

// The Types filter: a button that opens checkboxes grouped by category. A
// category's box chooses or clears all its types, and shows a dash when only
// some are chosen. Nothing chosen means every type.

export function TypeFilter({
  types,
  onChange,
}: {
  types: readonly EventType[];
  onChange: (types: EventType[]) => void;
}) {
  const id = useId();
  const chosen = new Set(types);
  /** The new choice (eventLogSearch puts it in the catalogue's order). */
  const choose = (change: (next: Set<EventType>) => void) => {
    const next = new Set(chosen);
    change(next);
    onChange([...next]);
  };
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline">
          {types.length === 0
            ? "All types"
            : types.length === 1
              ? "1 type"
              : `${types.length} types`}
          <ChevronDownIcon data-icon="inline-end" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="max-h-(--radix-popover-content-available-height) overflow-y-auto"
      >
        <div className="flex flex-col gap-3">
          {TYPE_GROUPS.map(({ category, types: groupTypes }) => {
            const count = groupTypes.filter((type) => chosen.has(type)).length;
            const groupId = `${id}-${category}`;
            return (
              <fieldset key={category} className="flex flex-col gap-1.5">
                <legend className="sr-only">{CATEGORY_LABEL[category]}</legend>
                <label
                  htmlFor={groupId}
                  className="flex items-center gap-2 font-medium"
                >
                  <Checkbox
                    id={groupId}
                    checked={
                      count === groupTypes.length
                        ? true
                        : count > 0
                          ? "indeterminate"
                          : false
                    }
                    onCheckedChange={() => {
                      choose((next) => {
                        const all = count === groupTypes.length;
                        for (const type of groupTypes) {
                          if (all) next.delete(type);
                          else next.add(type);
                        }
                      });
                    }}
                  />
                  {CATEGORY_LABEL[category]}
                </label>
                {groupTypes.map((type) => (
                  <label
                    key={type}
                    htmlFor={`${id}-${type}`}
                    className="ml-6 flex items-center gap-2"
                  >
                    <Checkbox
                      id={`${id}-${type}`}
                      checked={chosen.has(type)}
                      onCheckedChange={(checked) => {
                        choose((next) => {
                          if (checked === true) next.add(type);
                          else next.delete(type);
                        });
                      }}
                    />
                    {TYPE_LABEL[type]}
                  </label>
                ))}
              </fieldset>
            );
          })}
          <Button
            variant="outline"
            size="sm"
            disabled={types.length === 0}
            onClick={() => {
              onChange([]);
            }}
          >
            Show every type
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
