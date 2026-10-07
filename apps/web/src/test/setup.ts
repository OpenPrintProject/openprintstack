// SPDX-FileCopyrightText: 2026 Open Print Stack contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

// Testing Library unmounts what a test rendered only by itself when Vitest's
// globals are on, which they aren't here.
afterEach(() => {
  cleanup();
});

// jsdom doesn't scroll, and says so on the console whenever the router's
// scroll restoration asks it to.
if (typeof window !== "undefined") {
  window.scrollTo = () => {};
}
