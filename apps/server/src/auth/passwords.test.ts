// SPDX-FileCopyrightText: 2026 Open Print Stack contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { scrypt } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import {
  formatHash,
  parseHash,
  Passwords,
  SCRYPT_PARAMS,
} from "./passwords.ts";

/** Cheap settings, so the tests that don't check the real ones run fast. */
const FAST = { ln: 4, r: 8, p: 1 };

describe("SCRYPT_PARAMS", () => {
  it("is OWASP's minimum: N=2^17, r=8, p=1", () => {
    expect(SCRYPT_PARAMS).toEqual({ ln: 17, r: 8, p: 1 });
  });

  it("hashes with it by default, as a PHC string with a 16-byte salt and a 32-byte hash", async () => {
    const hash = await new Passwords().hash("correct horse battery");

    expect(hash).toMatch(
      /^\$scrypt\$ln=17,r=8,p=1\$[A-Za-z0-9+/]{22}\$[A-Za-z0-9+/]{43}$/,
    );
  });
});

describe("Passwords", () => {
  it("verifies the right password and refuses others", async () => {
    const passwords = new Passwords(FAST);
    const hash = await passwords.hash("correct horse battery");

    await expect(
      passwords.verify("correct horse battery", hash),
    ).resolves.toEqual({ ok: true, rehash: false });
    await expect(
      passwords.verify("correct horse batterY", hash),
    ).resolves.toEqual({ ok: false, rehash: false });
    await expect(passwords.verify("", hash)).resolves.toEqual({
      ok: false,
      rehash: false,
    });
  });

  it("salts each hash differently", async () => {
    const passwords = new Passwords(FAST);

    const first = await passwords.hash("correct horse battery");
    const second = await passwords.hash("correct horse battery");

    expect(first).not.toBe(second);
    expect(parseHash(first)?.salt).not.toEqual(parseHash(second)?.salt);
  });

  it("matches a password typed in another Unicode form", async () => {
    const passwords = new Passwords(FAST);
    const hash = await passwords.hash("café ﬁlter 12");

    await expect(
      passwords.verify("café filter 12", hash),
    ).resolves.toMatchObject({ ok: true });
  });

  it("passes N, r and p to scrypt (RFC 7914's test vector)", async () => {
    // RFC 7914 §12: P="password", S="NaCl", N=1024, r=8, p=16, dkLen=64.
    const hash = formatHash(
      { ln: 10, r: 8, p: 16 },
      Buffer.from("NaCl"),
      Buffer.from(
        "fdbabe1c9d3472007856e7190d01e9fe7c6ad7cbc8237830e77376634b3731622eaf30d92e22a3886ff109279d9830dac727afb94a83ee6d8360cbdfa2cc0640",
        "hex",
      ),
    );

    await expect(
      new Passwords(FAST).verify("password", hash),
    ).resolves.toMatchObject({ ok: true });
  });

  it("asks for a rehash when the hash used other settings, only if it matches", async () => {
    const old = await new Passwords({ ln: 5, r: 8, p: 1 }).hash(
      "correct horse battery",
    );
    const passwords = new Passwords(FAST);

    await expect(
      passwords.verify("correct horse battery", old),
    ).resolves.toEqual({ ok: true, rehash: true });
    await expect(passwords.verify("wrong password!", old)).resolves.toEqual({
      ok: false,
      rehash: false,
    });
  });

  it.each([
    ["r", { ln: 4, r: 4, p: 1 }],
    ["p", { ln: 4, r: 8, p: 2 }],
  ])("asks for a rehash when only %s differs", async (_, params) => {
    const old = await new Passwords(params).hash("correct horse battery");

    await expect(
      new Passwords(FAST).verify("correct horse battery", old),
    ).resolves.toEqual({ ok: true, rehash: true });
  });

  it.each([
    ["a 4-byte salt", 4, 32],
    ["a 64-byte hash", 16, 64],
  ])(
    "asks for a rehash when a matching hash has %s",
    async (_, saltBytes, keyBytes) => {
      const salt = Buffer.alloc(saltBytes, 7);
      const hash = formatHash(
        FAST,
        salt,
        await scryptKey("correct horse battery", salt, keyBytes),
      );

      await expect(
        new Passwords(FAST).verify("correct horse battery", hash),
      ).resolves.toEqual({ ok: true, rehash: true });
    },
  );

  it("throws for a stored hash that isn't a scrypt PHC string", async () => {
    await expect(
      new Passwords(FAST).verify(
        "x",
        "$argon2id$v=19$m=65536,t=3,p=4$c2FsdA$aGFzaA",
      ),
    ).rejects.toThrow("The stored password hash isn't a scrypt PHC string.");
  });

  it("checks a password against a throwaway hash for a missing user", async () => {
    const passwords = new Passwords(FAST);
    const hash = vi.spyOn(passwords, "hash");
    const verify = vi.spyOn(passwords, "verify");

    await expect(passwords.verifyNobody("guess one")).resolves.toEqual({
      ok: false,
      rehash: false,
    });
    await expect(passwords.verifyNobody("guess two")).resolves.toEqual({
      ok: false,
      rehash: false,
    });

    // One throwaway hash, made once, and a real scrypt check each time.
    expect(hash).toHaveBeenCalledTimes(1);
    expect(verify).toHaveBeenCalledTimes(2);
    expect(verify).toHaveBeenNthCalledWith(
      1,
      "guess one",
      expect.stringMatching(/^\$scrypt\$ln=4,r=8,p=1\$/),
    );
  });
});

describe("parseHash", () => {
  it("reads a PHC string", () => {
    expect(parseHash("$scrypt$ln=17,r=8,p=1$c2FsdA$aGFzaA")).toEqual({
      params: { ln: 17, r: 8, p: 1 },
      salt: Buffer.from("salt"),
      key: Buffer.from("hash"),
    });
  });

  it.each([
    ["another algorithm", "$argon2id$ln=17,r=8,p=1$c2FsdA$aGFzaA"],
    ["no hash", "$scrypt$ln=17,r=8,p=1$c2FsdA"],
    ["padding", "$scrypt$ln=17,r=8,p=1$c2FsdA==$aGFzaA"],
    ["parameters in another order", "$scrypt$r=8,ln=17,p=1$c2FsdA$aGFzaA"],
    ["ln 0", "$scrypt$ln=0,r=8,p=1$c2FsdA$aGFzaA"],
    ["ln 21", "$scrypt$ln=21,r=1,p=1$c2FsdA$aGFzaA"],
    ["r 17", "$scrypt$ln=4,r=17,p=1$c2FsdA$aGFzaA"],
    ["p 17", "$scrypt$ln=4,r=8,p=17$c2FsdA$aGFzaA"],
    ["more than 1 GiB", "$scrypt$ln=20,r=16,p=1$c2FsdA$aGFzaA"],
    ["base64 that doesn't round-trip", "$scrypt$ln=17,r=8,p=1$c2FsdB$aGFzaA"],
    ["an empty string", ""],
  ])("refuses %s", (_, hash) => {
    expect(parseHash(hash)).toBeUndefined();
  });

  it("allows up to 1 GiB", () => {
    expect(parseHash("$scrypt$ln=20,r=8,p=1$c2FsdA$aGFzaA")).toBeDefined();
  });
});

/** scrypt with the FAST settings, worked out here independently. */
function scryptKey(
  password: string,
  salt: Buffer,
  keyBytes: number,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(
      password.normalize("NFKC"),
      salt,
      keyBytes,
      { N: 2 ** FAST.ln, r: FAST.r, p: FAST.p },
      (error, key) => {
        if (error) reject(error);
        else resolve(key);
      },
    );
  });
}
