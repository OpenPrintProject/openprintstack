// SPDX-FileCopyrightText: 2026 Open Print Stack contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { DriverManifest, type DriverModule } from "@openprintstack/driver-sdk";
import { z } from "zod";

// The driver types the server knows, and where their modules come from. This
// is the only server file that may import a driver package; everything else
// talks to the driver interface.

/** Where one driver type's module comes from. */
export type DriverSource = {
  /**
   * The module specifier, which a worker would import to run the driver
   * outside this process.
   */
  readonly specifier: string;
  /**
   * Imports the module here. It names the same specifier as a literal, so
   * bundlers can follow it; a test checks the two agree.
   */
  readonly load: () => Promise<unknown>;
};

/** The driver types in this build, keyed by `manifest.type`. */
export const DRIVER_SOURCES = {
  simulated: {
    specifier: "@openprintstack/driver-simulated",
    load: () => import("@openprintstack/driver-simulated"),
  },
} as const satisfies Readonly<Record<string, DriverSource>>;

export class DriverRegistry {
  readonly #sources: Readonly<Record<string, DriverSource>>;
  readonly #loading = new Map<string, Promise<DriverModule>>();

  constructor(
    sources: Readonly<Record<string, DriverSource>> = DRIVER_SOURCES,
  ) {
    this.#sources = sources;
  }

  /** Every registered driver type, in registration order. */
  types(): string[] {
    return Object.keys(this.#sources);
  }

  /** Own keys only, so `toString` or `__proto__` is never a driver type. */
  has(type: string): boolean {
    return Object.hasOwn(this.#sources, type);
  }

  /**
   * The driver module for `type`, imported the first time it's asked for.
   * Fails if the type isn't registered, or if what the import gives isn't a
   * driver module for that type. A failed load is tried again next time.
   */
  load(type: string): Promise<DriverModule> {
    let loading = this.#loading.get(type);
    if (loading === undefined) {
      loading = this.#import(type);
      this.#loading.set(type, loading);
      void loading.catch(() => this.#loading.delete(type));
    }
    return loading;
  }

  async #import(type: string): Promise<DriverModule> {
    const source = this.has(type) ? this.#sources[type] : undefined;
    if (source === undefined) {
      throw new Error(`No driver is registered for type "${type}".`);
    }
    const imported: unknown = await source.load();
    return toDriverModule(type, source.specifier, imported);
  }
}

/** Checks an imported module's default export is a driver for `type`. */
function toDriverModule(
  type: string,
  specifier: string,
  imported: unknown,
): DriverModule {
  const problem = (reason: string) =>
    new Error(`${specifier} isn't a driver module for "${type}": ${reason}`);

  const module = (imported as { default?: unknown } | null)?.default;
  if (typeof module !== "object" || module === null) {
    throw problem("it has no default export.");
  }
  const { manifest, settingsSchema, initialCapabilities, create } =
    module as Record<string, unknown>;
  const parsed = DriverManifest.safeParse(manifest);
  if (!parsed.success) {
    throw problem(`its manifest is invalid. ${z.prettifyError(parsed.error)}`);
  }
  if (parsed.data.type !== type) {
    throw problem(`its manifest says its type is "${parsed.data.type}".`);
  }
  if (!(settingsSchema instanceof z.ZodObject)) {
    throw problem("its settingsSchema isn't a Zod object.");
  }
  if (typeof initialCapabilities !== "function") {
    throw problem("it has no initialCapabilities function.");
  }
  if (typeof create !== "function") {
    throw problem("it has no create function.");
  }
  return module as DriverModule;
}
