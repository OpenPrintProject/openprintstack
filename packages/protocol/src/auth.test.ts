// SPDX-FileCopyrightText: 2026 Open Print Stack contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from "vitest";

import {
  NewPassword,
  normalizePassword,
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  passwordLength,
  Username,
} from "./index.ts";

describe("the password rules", () => {
  it("are 12 to 1024 code points", () => {
    expect(PASSWORD_MIN_LENGTH).toBe(12);
    expect(PASSWORD_MAX_LENGTH).toBe(1024);
  });

  it.each([
    ["ASCII", "abcdefghijkl", 12],
    ["an emoji as one", "😀".repeat(12), 12],
    ["a decomposed é as one, after NFKC", "é".repeat(12), 12],
    ["a ligature as two, after NFKC", "ﬁ", 2],
    ["spaces, which aren't trimmed", "  a  ", 5],
  ])("count %s", (_, password, length) => {
    expect(passwordLength(password)).toBe(length);
  });

  it("normalise with NFKC", () => {
    expect(normalizePassword("ﬁ")).toBe("fi");
    expect(normalizePassword("é")).toBe("é");
  });
});

describe("NewPassword", () => {
  it.each([
    ["11 characters", "a".repeat(11), "Must be at least 12 characters."],
    [
      "6 decomposed é (12 UTF-16 units)",
      "é".repeat(6),
      "Must be at least 12 characters.",
    ],
    ["1025 characters", "a".repeat(1025), "Must be at most 1024 characters."],
  ] as const)("refuses %s", (_, password, message) => {
    const result = NewPassword.safeParse(password);

    expect(result.error?.issues.map((issue) => issue.message)).toEqual([
      message,
    ]);
  });

  it.each([
    ["12 characters", "a".repeat(12)],
    ["1024 characters", "a".repeat(1024)],
    ["12 emoji (24 UTF-16 units)", "😀".repeat(12)],
    ["12 spaces, not trimmed", " ".repeat(12)],
  ] as const)("accepts %s", (_, password) => {
    expect(NewPassword.safeParse(password).success).toBe(true);
  });

  it("gives the password in NFKC form", () => {
    expect(NewPassword.parse("ﬁ".repeat(12))).toBe("fi".repeat(12));
  });
});

describe("Username", () => {
  it.each(["rob", "a", "a".repeat(32), "R.o_b-2"])("accepts %j", (name) => {
    expect(Username.parse(name)).toBe(name);
  });

  it("trims spaces", () => {
    expect(Username.parse("  rob ")).toBe("rob");
  });

  it.each(["", " ", "a".repeat(33), "rob smith", "röb", "rob@home"])(
    "refuses %j",
    (name) => {
      const result = Username.safeParse(name);

      expect(result.error?.issues.map((issue) => issue.message)).toEqual([
        "Must be 1–32 letters (a–z), digits, dots, underscores or hyphens.",
      ]);
    },
  );
});
