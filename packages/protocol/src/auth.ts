// SPDX-FileCopyrightText: 2026 Open Print Stack contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { z } from "zod";

// The rules for a new account's username and password. The server checks
// setup requests with these schemas, and the web app's setup form checks the
// same ones before sending, so both refuse the same input with the same
// message.
//
// Passwords are NFKC-normalised before they're counted or hashed, so the same
// password typed on two devices hashes the same (NIST SP 800-63B).

/** The fewest code points a new password may have, after NFKC. */
export const PASSWORD_MIN_LENGTH = 12;

/** The most code points a password may have, after NFKC. */
export const PASSWORD_MAX_LENGTH = 1024;

/** The form passwords are counted and hashed in. */
export function normalizePassword(password: string): string {
  return password.normalize("NFKC");
}

/** How long the rules consider a password: its Unicode code points. */
export function passwordLength(password: string): number {
  return [...normalizePassword(password)].length;
}

/** 1–32 ASCII letters, digits, dots, underscores or hyphens, after trimming. */
export const Username = z
  .string()
  .trim()
  .regex(/^[A-Za-z0-9._-]{1,32}$/, {
    error: "Must be 1–32 letters (a–z), digits, dots, underscores or hyphens.",
  })
  .meta({
    description:
      "1–32 ASCII letters, digits, dots, underscores or hyphens, after trimming. Matched ignoring case.",
  });

/** 12–1024 code points after NFKC normalisation. */
export const NewPassword = z
  .string()
  .normalize("NFKC")
  .refine((password) => passwordLength(password) >= PASSWORD_MIN_LENGTH, {
    error: `Must be at least ${PASSWORD_MIN_LENGTH} characters.`,
  })
  .refine((password) => passwordLength(password) <= PASSWORD_MAX_LENGTH, {
    error: `Must be at most ${PASSWORD_MAX_LENGTH} characters.`,
  })
  .meta({
    minLength: PASSWORD_MIN_LENGTH,
    maxLength: PASSWORD_MAX_LENGTH,
    description: `${PASSWORD_MIN_LENGTH}–${PASSWORD_MAX_LENGTH} characters (Unicode code points), counted after NFKC normalisation. Spaces count and nothing is trimmed.`,
  });
