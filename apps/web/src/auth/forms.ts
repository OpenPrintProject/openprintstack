// SPDX-FileCopyrightText: 2026 Open Print Stack contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  NewPassword,
  normalizePassword,
  Username,
} from "@openprintstack/protocol";
import { z } from "zod";

// What the login and setup forms check before sending.

/**
 * protocol's username and password rules, which the server checks too, and a
 * confirmation that's only checked here. NFKC makes "é" typed two ways the
 * same password, as the server will hash it.
 */
export const SetupForm = z
  .object({ username: Username, password: NewPassword, confirm: z.string() })
  .refine(
    ({ password, confirm }) =>
      normalizePassword(password) === normalizePassword(confirm),
    // Zod still runs this when a field fails its own rules (only a field of
    // the wrong type would stop it), so a mismatch shows alongside them.
    { path: ["confirm"], error: "The passwords don't match." },
  );

export const LoginForm = z.object({
  username: z.string().trim().min(1, "Enter your username."),
  password: z.string().min(1, "Enter your password."),
});
