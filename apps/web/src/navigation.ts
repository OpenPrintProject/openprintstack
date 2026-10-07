// SPDX-FileCopyrightText: 2026 Open Print Stack contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

/** Stands in for the page's origin when checking a path. */
const BASE = "http://app.invalid";

/**
 * Where to go after logging in: `target` if it's a path in this app (as
 * /login?redirect=… carries it), else "/". A crafted link can't send anyone
 * to another site: "//evil.example", "/\\evil.example" and full URLs all
 * resolve to another origin and are refused.
 */
export function safeRedirect(target: string | undefined): string {
  if (target?.startsWith("/") !== true) return "/";
  let url: URL;
  try {
    url = new URL(target, BASE);
  } catch {
    return "/";
  }
  if (url.origin !== BASE) return "/";
  return url.pathname + url.search + url.hash;
}
