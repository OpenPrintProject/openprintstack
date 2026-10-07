// SPDX-FileCopyrightText: 2026 Open Print Stack contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

// Testing Library unmounts what a test rendered only by itself when Vitest's
// globals are on, which they aren't here.
afterEach(() => {
  cleanup();
});

if (typeof window !== "undefined") {
  // jsdom doesn't scroll, and says so on the console whenever the router's
  // scroll restoration asks it to.
  window.scrollTo = () => {};

  // jsdom has no matchMedia, which sonner's theme="system" reads: a light
  // colour scheme that never changes.
  if (typeof (window as { matchMedia?: unknown }).matchMedia !== "function") {
    window.matchMedia = (query: string): MediaQueryList => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    });
  }

  // Nor ResizeObserver, which Radix's slider uses to size its thumb.
  window.ResizeObserver ??= class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  };
}
