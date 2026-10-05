// SPDX-FileCopyrightText: 2026 Open Print Stack contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { z } from "zod";

import { Id } from "./common.ts";

/** A camera on a printer. Snapshots are requested by its `id`. */
export const Camera = z
  .object({
    id: Id,
    label: z.string(),
  })
  .meta({ id: "Camera" });

export type Camera = z.infer<typeof Camera>;
