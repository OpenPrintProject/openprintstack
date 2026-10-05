// SPDX-FileCopyrightText: 2026 Open Print Stack contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { z } from "zod";

/** The body of every REST error response. */
export const ApiError = z
  .object({
    error: z.object({
      code: z.string().min(1),
      message: z.string(),
      /** Extra context, such as validation issues. */
      details: z.json().optional(),
    }),
  })
  .meta({ id: "ApiError" });

export type ApiError = z.infer<typeof ApiError>;
