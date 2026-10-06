// SPDX-FileCopyrightText: 2026 Open Print Stack contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from "vitest";

import { LoginForm, SetupForm } from "./forms.ts";

/** Each failing field's messages. */
function problems(result: {
  error?: { issues: { path: PropertyKey[]; message: string }[] };
}): Record<string, string[]> {
  const found: Record<string, string[]> = {};
  for (const issue of result.error?.issues ?? []) {
    const field = String(issue.path[0]);
    (found[field] ??= []).push(issue.message);
  }
  return found;
}

describe("SetupForm", () => {
  it("takes protocol's rules: 12 characters", () => {
    expect(
      SetupForm.safeParse({
        username: "rob",
        password: "a".repeat(12),
        confirm: "a".repeat(12),
      }).success,
    ).toBe(true);
    expect(
      problems(
        SetupForm.safeParse({
          username: "rob",
          password: "a".repeat(11),
          confirm: "a".repeat(11),
        }),
      ),
    ).toEqual({ password: ["Must be at least 12 characters."] });
  });

  it("says when the confirmation doesn't match, alongside other problems", () => {
    expect(
      problems(
        SetupForm.safeParse({
          username: "",
          password: "short",
          confirm: "shorter",
        }),
      ),
    ).toEqual({
      username: [
        "Must be 1–32 letters (a–z), digits, dots, underscores or hyphens.",
      ],
      password: ["Must be at least 12 characters."],
      confirm: ["The passwords don't match."],
    });
  });

  it("compares the passwords as the server will hash them (NFKC)", () => {
    const composed = "café café café";
    const decomposed = "café café café";

    expect(
      SetupForm.safeParse({
        username: "rob",
        password: composed,
        confirm: decomposed,
      }).success,
    ).toBe(true);
  });
});

describe("LoginForm", () => {
  it("asks for both fields", () => {
    expect(
      problems(LoginForm.safeParse({ username: "  ", password: "" })),
    ).toEqual({
      username: ["Enter your username."],
      password: ["Enter your password."],
    });
  });

  it("takes any password: the rules are only for new ones", () => {
    expect(
      LoginForm.safeParse({ username: "rob", password: "x" }).success,
    ).toBe(true);
  });
});
