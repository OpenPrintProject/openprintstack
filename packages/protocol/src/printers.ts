// SPDX-FileCopyrightText: 2026 Open Print Stack contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { z } from "zod";

// The rules for a printer's name. The server checks new printers and renames
// with this schema, and the web app's printer forms check the same one before
// sending, so both refuse the same input with the same message.

/** Trimmed, NFC, 1–64 code points, no control characters. */
export const PrinterName = z
  .string()
  .trim()
  .normalize("NFC")
  .refine((name) => [...name].length >= 1, { error: "Must not be empty." })
  .refine((name) => [...name].length <= 64, {
    error: "Must be at most 64 characters.",
  })
  .refine((name) => !/\p{Cc}/u.test(name), {
    error: "Must not contain control characters.",
  })
  .meta({
    minLength: 1,
    maxLength: 64,
    description:
      "1–64 characters after trimming, with no control characters. Unique, ignoring the case of A–Z.",
  });
