// SPDX-FileCopyrightText: 2026 Open Print Stack contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from "vitest";

import {
  redactSecrets,
  secretsSet,
  secretValues,
  withoutBlankSecrets,
  withoutSecrets,
} from "./secrets.ts";
import { TestDrivers } from "./test-driver.ts";

const WRITE_ONLY = ["accessCode", "apiKey"];

describe("secretsSet", () => {
  it("names the write-only fields with a value, in the schema's order", () => {
    expect(
      secretsSet({ apiKey: "k", accessCode: "c", host: "h" }, WRITE_ONLY),
    ).toEqual(["accessCode", "apiKey"]);
  });

  it("leaves out fields that are missing or empty", () => {
    expect(secretsSet({ accessCode: "", host: "h" }, WRITE_ONLY)).toEqual([]);
  });
});

describe("withoutSecrets", () => {
  it("drops the write-only fields and keeps the rest", () => {
    expect(
      withoutSecrets(
        { host: "h", accessCode: "c", port: 1, lan: true },
        WRITE_ONLY,
      ),
    ).toEqual({ host: "h", port: 1, lan: true });
  });
});

describe("withoutBlankSecrets", () => {
  it("drops empty write-only values only", () => {
    expect(
      withoutBlankSecrets(
        { accessCode: "", apiKey: "k", host: "", port: 1 },
        WRITE_ONLY,
      ),
    ).toEqual({ apiKey: "k", host: "", port: 1 });
  });

  it.each([null, "settings", [1], undefined])(
    "returns %j as it is, for the schema to refuse",
    (input) => {
      expect(withoutBlankSecrets(input, WRITE_ONLY)).toBe(input);
    },
  );
});

describe("secretValues", () => {
  const { module } = new TestDrivers();

  it("gives the values of the module's write-only fields that are set", () => {
    expect(
      secretValues(module, { nozzleMaxC: 250, accessCode: "1234" }),
    ).toEqual(["1234"]);
  });

  it("is empty when none is set", () => {
    expect(secretValues(module, { nozzleMaxC: 250, accessCode: "" })).toEqual(
      [],
    );
    expect(secretValues(module, { nozzleMaxC: 250 })).toEqual([]);
  });
});

describe("redactSecrets", () => {
  it("replaces each secret in strings, keys and nested values", () => {
    expect(
      redactSecrets(
        {
          message: "code 1234, again 1234",
          list: ["x1234y", 1234, null, true],
          nested: { "1234": "key", deeper: { url: "u:abcd@h" } },
        },
        ["1234", "abcd"],
      ),
    ).toEqual({
      message: "code [Redacted], again [Redacted]",
      list: ["x[Redacted]y", 1234, null, true],
      nested: { "[Redacted]": "key", deeper: { url: "u:[Redacted]@h" } },
    });
  });

  it("replaces a secret that contains another whole", () => {
    expect(redactSecrets("abc abcdef", ["abc", "abcdef"])).toBe(
      "[Redacted] [Redacted]",
    );
  });

  it("matches a secret's characters literally", () => {
    expect(redactSecrets("a.b+c a-b-c", ["a.b+c"])).toBe("[Redacted] a-b-c");
  });

  it("never searches its own replacements", () => {
    expect(redactSecrets("act", ["act", "Red"])).toBe("[Redacted]");
  });

  it("copies objects as plain objects, keeping byte arrays as they are", () => {
    const bytes = new Uint8Array([1, 2]);
    class Thing {
      label = "a 1234";
    }

    const redacted = redactSecrets({ bytes, thing: new Thing() }, ["1234"]);

    expect(redacted.bytes).toBe(bytes);
    expect(redacted.thing).toStrictEqual({ label: "a [Redacted]" });
  });

  it("returns the value itself when there are no secrets", () => {
    const value = { message: "1234" };

    expect(redactSecrets(value, [])).toBe(value);
  });
});
