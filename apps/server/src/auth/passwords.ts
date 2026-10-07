// SPDX-FileCopyrightText: 2026 Open Print Stack contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";

import { normalizePassword } from "@openprintstack/protocol";

// Password hashing with scrypt from node:crypto. Hashes are stored as PHC
// strings, which carry their own settings, so they can be raised later:
//
//   $scrypt$ln=17,r=8,p=1$<salt>$<hash>     (unpadded base64)
//
// Passwords are NFKC-normalised before they're hashed (protocol's
// `normalizePassword`, which also holds the length rules), so the same
// password typed on two devices hashes the same (NIST SP 800-63B).

/** scrypt's settings: N = 2^ln (memory and time), block size r, passes p. */
export type ScryptParams = {
  readonly ln: number;
  readonly r: number;
  readonly p: number;
};

/**
 * OWASP's recommended minimum: 128 MiB and about 170 ms per hash on an Apple
 * M5 Pro.
 */
export const SCRYPT_PARAMS: ScryptParams = Object.freeze({
  ln: 17,
  r: 8,
  p: 1,
});

const SALT_BYTES = 16;
const KEY_BYTES = 32;

/** What a PHC string holds. */
type ParsedHash = {
  readonly params: ScryptParams;
  readonly salt: Buffer;
  readonly key: Buffer;
};

/**
 * Stored settings outside these bounds aren't ours, and could make one login
 * take gigabytes of memory.
 */
const BOUNDS = { ln: [1, 20], r: [1, 16], p: [1, 16] } as const;

/** 1 GiB: the most memory a stored hash's settings may need. */
const MAX_MEMORY = 2 ** 30;

const PHC =
  /^\$scrypt\$ln=(\d+),r=(\d+),p=(\d+)\$([A-Za-z0-9+/]+)\$([A-Za-z0-9+/]+)$/;

export function formatHash(
  params: ScryptParams,
  salt: Uint8Array,
  key: Uint8Array,
): string {
  return `$scrypt$ln=${params.ln},r=${params.r},p=${params.p}$${base64(salt)}$${base64(key)}`;
}

/** Undefined unless `hash` is a scrypt PHC string with sensible settings. */
export function parseHash(hash: string): ParsedHash | undefined {
  const match = PHC.exec(hash);
  if (match === null) return undefined;
  const [, ln = "", r = "", p = "", salt = "", key = ""] = match;
  const params = { ln: Number(ln), r: Number(r), p: Number(p) };
  for (const name of ["ln", "r", "p"] as const) {
    const [min, max] = BOUNDS[name];
    if (params[name] < min || params[name] > max) return undefined;
  }
  if (128 * 2 ** params.ln * params.r > MAX_MEMORY) return undefined;
  const saltBytes = Buffer.from(salt, "base64");
  const keyBytes = Buffer.from(key, "base64");
  // Refuses base64 that doesn't round-trip, e.g. with stray bits at the end.
  if (base64(saltBytes) !== salt || base64(keyBytes) !== key) return undefined;
  return { params, salt: saltBytes, key: keyBytes };
}

export type Verification = {
  readonly ok: boolean;
  /**
   * The hash was made with other settings than the current ones, so the
   * password should be hashed again and stored. Only true when `ok` is.
   */
  readonly rehash: boolean;
};

export class Passwords {
  readonly #params: ScryptParams;
  #nobody: Promise<string> | undefined;

  /** Tests pass cheaper settings; the server uses `SCRYPT_PARAMS`. */
  constructor(params: ScryptParams = SCRYPT_PARAMS) {
    this.#params = Object.freeze({ ...params });
  }

  get params(): ScryptParams {
    return this.#params;
  }

  /** A new PHC string for the password, with a random salt. */
  async hash(password: string): Promise<string> {
    const salt = randomBytes(SALT_BYTES);
    const key = await derive(password, salt, this.#params, KEY_BYTES);
    return formatHash(this.#params, salt, key);
  }

  /**
   * Whether the password matches the hash, compared in constant time. Throws
   * if the stored hash isn't a scrypt PHC string.
   */
  async verify(password: string, hash: string): Promise<Verification> {
    const parsed = parseHash(hash);
    if (parsed === undefined) {
      throw new Error("The stored password hash isn't a scrypt PHC string.");
    }
    const key = await derive(
      password,
      parsed.salt,
      parsed.params,
      parsed.key.length,
    );
    const ok = timingSafeEqual(key, parsed.key);
    const current =
      parsed.params.ln === this.#params.ln &&
      parsed.params.r === this.#params.r &&
      parsed.params.p === this.#params.p &&
      parsed.salt.length === SALT_BYTES &&
      parsed.key.length === KEY_BYTES;
    return { ok, rehash: ok && !current };
  }

  /**
   * Takes as long as checking a password against a real user's hash, for a
   * username that doesn't exist, so the response time doesn't tell. Always
   * fails.
   */
  async verifyNobody(password: string): Promise<Verification> {
    this.#nobody ??= this.hash(randomBytes(32).toString("base64"));
    await this.verify(password, await this.#nobody);
    return { ok: false, rehash: false };
  }
}

function derive(
  password: string,
  salt: Uint8Array,
  params: ScryptParams,
  keyLength: number,
): Promise<Buffer> {
  const N = 2 ** params.ln;
  return new Promise((resolve, reject) => {
    scrypt(
      normalizePassword(password),
      salt,
      keyLength,
      // Node refuses more than 32 MiB by default; scrypt needs 128·N·r.
      { N, r: params.r, p: params.p, maxmem: 256 * N * params.r },
      (error, key) => {
        if (error) reject(error);
        else resolve(key);
      },
    );
  });
}

/** Unpadded base64, as PHC strings use. */
function base64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64").replace(/=+$/, "");
}
