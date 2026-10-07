// SPDX-FileCopyrightText: 2026 Open Print Stack contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { createMemoryHistory } from "@tanstack/react-router";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { AppRoot, createApp } from "../app.tsx";
import type { FakeServer } from "./fake-server.ts";

// The whole app (router, guards, forms, API client and realtime client)
// against a fake server, starting at `path`.

export function renderApp(server: FakeServer, path = "/") {
  const app = createApp({
    origin: "http://localhost:5173",
    fetch: server.fetch,
    createSocket: server.createSocket,
    history: createMemoryHistory({ initialEntries: [path] }),
    random: () => 0,
    retryDelayMs: 1,
  });
  // Every page the router starts loading, redirects included.
  const visited: string[] = [];
  app.router.subscribe("onBeforeLoad", (event) => {
    visited.push(event.toLocation.pathname);
  });
  render(<AppRoot app={app} />);
  return { app, visited, user: userEvent.setup() };
}

/** Where the app is: path, search and hash. */
export function location(app: ReturnType<typeof createApp>): string {
  return app.router.state.location.href;
}

export async function heading(name: string | RegExp): Promise<HTMLElement> {
  return screen.findByRole("heading", { name });
}

/**
 * Lets the page catch up with the server: socket messages and fetches answer
 * in later tasks, and TanStack Query tells React about changes in one too.
 */
export async function settle(): Promise<void> {
  await act(async () => {
    for (let i = 0; i < 5; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  });
}
