// SPDX-FileCopyrightText: 2026 Open Print Stack contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { act, screen, waitFor } from "@testing-library/react";
import type userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { sessionQuery } from "./api/session.ts";
import { socketUrl } from "./app.tsx";
import { apiError, FakeServer, ROB } from "./test/fake-server.ts";
import { printerSnapshot } from "./test/fake-socket.ts";
import { heading, location, renderApp } from "./test/render-app.tsx";

// The whole app (router, guards, forms, API client and realtime client)
// against a fake server.

const SETUP = "Welcome to Open Print Stack";
const LOGIN = "Log in to Open Print Stack";
const PRINTERS = "Printers";

async function fillSetup(
  user: ReturnType<typeof userEvent.setup>,
  values: { username?: string; password: string; confirm?: string },
): Promise<void> {
  await user.type(screen.getByLabelText("Username"), values.username ?? "rob");
  await user.type(screen.getByLabelText("Password"), values.password);
  await user.type(
    screen.getByLabelText("Confirm password"),
    values.confirm ?? values.password,
  );
  await user.click(
    screen.getByRole("button", { name: "Create the admin account" }),
  );
}

async function logIn(
  user: ReturnType<typeof userEvent.setup>,
  password = ROB.password,
): Promise<void> {
  await user.type(screen.getByLabelText("Username"), ROB.username);
  await user.type(screen.getByLabelText("Password"), password);
  await user.click(screen.getByRole("button", { name: "Log in" }));
}

describe("first run", () => {
  it.each(["/", "/login"])(
    "sends %s straight to the setup page while no user exists",
    async (path) => {
      const { app, visited } = renderApp(new FakeServer(), path);

      await heading(SETUP);

      expect(location(app)).toBe("/setup");
      expect(visited).toEqual([path, "/setup"]);
    },
  );

  it("refuses an 11-character password without sending it", async () => {
    const server = new FakeServer();
    const { user } = renderApp(server, "/setup");
    await heading(SETUP);

    await fillSetup(user, { password: "a".repeat(11) });

    expect(
      await screen.findByText("Must be at least 12 characters."),
    ).toBeDefined();
    expect(screen.getByLabelText("Password").getAttribute("aria-invalid")).toBe(
      "true",
    );
    expect(server.requestsTo("POST /api/auth/setup")).toEqual([]);
  });

  it("refuses passwords that don't match, and a username with a space", async () => {
    const server = new FakeServer();
    const { user } = renderApp(server, "/setup");
    await heading(SETUP);

    await fillSetup(user, {
      username: "rob smith",
      password: "a".repeat(12),
      confirm: "b".repeat(12),
    });

    expect(await screen.findByText("The passwords don't match.")).toBeDefined();
    expect(
      screen.getByText(
        "Must be 1–32 letters (a–z), digits, dots, underscores or hyphens.",
      ),
    ).toBeDefined();
    expect(server.requestsTo("POST /api/auth/setup")).toEqual([]);
  });

  it("checks again as you type once you've tried to submit", async () => {
    const { user } = renderApp(new FakeServer(), "/setup");
    await heading(SETUP);
    await fillSetup(user, { password: "a".repeat(11) });
    await screen.findByText("Must be at least 12 characters.");

    await user.type(screen.getByLabelText("Password"), "a");

    expect(screen.queryByText("Must be at least 12 characters.")).toBeNull();
    expect(await screen.findByText("The passwords don't match.")).toBeDefined();
  });

  it("doesn't check while you type before the first submit", async () => {
    const { user } = renderApp(new FakeServer(), "/setup");
    await heading(SETUP);

    await user.type(screen.getByLabelText("Password"), "short");
    await user.tab();

    expect(screen.queryByText("Must be at least 12 characters.")).toBeNull();
  });

  it("creates the admin with a 12-character password and shows the printers, logged in and live", async () => {
    const server = new FakeServer();
    const { app, user } = renderApp(server, "/setup");
    await heading(SETUP);

    await fillSetup(user, { password: "a".repeat(12) });

    await heading(PRINTERS);
    expect(location(app)).toBe("/");
    expect(server.requestsTo("POST /api/auth/setup")).toEqual([
      { username: "rob", password: "a".repeat(12) },
    ]);
    expect(screen.getByText("rob")).toBeDefined();
    await waitFor(() => {
      expect(screen.getByRole("status").textContent).toBe("Live");
    });
    expect(await screen.findByText("No printers yet.")).toBeDefined();
  });

  it("shows the server's answer when setup was done meanwhile, with a way to log in", async () => {
    const server = new FakeServer();
    const { user } = renderApp(server, "/setup");
    await heading(SETUP);
    server.users = [ROB];

    await fillSetup(user, { password: "a".repeat(12) });

    expect(
      await screen.findByText("Setup has already been done."),
    ).toBeDefined();
    expect(
      screen.getByRole("link", { name: "Go to the login page" }),
    ).toBeDefined();
  });

  it("sends the setup page to the login page once a user exists", async () => {
    const { app } = renderApp(FakeServer.withUser(), "/setup");

    await heading(LOGIN);

    expect(location(app)).toBe("/login");
  });
});

describe("logging in", () => {
  it("sends you to the login page, and back to where you were afterwards", async () => {
    const server = FakeServer.withUser();
    const { app, visited, user } = renderApp(server, "/?view=all");
    await heading(LOGIN);
    expect(location(app)).toBe("/login?redirect=%2F%3Fview%3Dall");
    expect(visited).toEqual(["/", "/login"]);

    await logIn(user);

    await heading(PRINTERS);
    expect(location(app)).toBe("/?view=all");
    expect(server.requestsTo("POST /api/auth/login")).toEqual([
      { username: "rob", password: ROB.password },
    ]);
  });

  it("shows the server's answer to a wrong password, and stays", async () => {
    const { app, user } = renderApp(FakeServer.withUser(), "/");
    await heading(LOGIN);

    await logIn(user, "wrong password");

    expect(
      await screen.findByText("The username or password is wrong."),
    ).toBeDefined();
    expect(location(app)).toBe("/login?redirect=%2F");
  });

  it("asks for both fields before sending", async () => {
    const server = FakeServer.withUser();
    const { user } = renderApp(server, "/login");
    await heading(LOGIN);

    await user.click(screen.getByRole("button", { name: "Log in" }));

    expect(await screen.findByText("Enter your username.")).toBeDefined();
    expect(screen.getByText("Enter your password.")).toBeDefined();
    expect(server.requestsTo("POST /api/auth/login")).toEqual([]);
  });

  it("won't send you to another site afterwards", async () => {
    const { app, user } = renderApp(
      FakeServer.withUser(),
      "/login?redirect=%2F%2Fevil.example%2Fsteal",
    );
    await heading(LOGIN);

    await logIn(user);

    await heading(PRINTERS);
    expect(location(app)).toBe("/");
  });

  it("skips the login and setup pages when you're already logged in", async () => {
    const server = FakeServer.withUser({ loggedIn: true });
    const { app } = renderApp(server, "/login?redirect=%2F%3Fview%3Dall");
    await heading(PRINTERS);
    expect(location(app)).toBe("/?view=all");

    await act(() => app.router.navigate({ to: "/setup" }));

    await heading(PRINTERS);
    expect(location(app)).toBe("/");
  });
});

describe("the logged-in shell", () => {
  it("shows who's logged in, that it's live, and every printer's status by name", async () => {
    const server = FakeServer.withUser({ loggedIn: true });
    server.printers = [
      printerSnapshot("p10", "Sim 10", { status: "idle" }),
      printerSnapshot("p2", "Sim 2", { status: "error" }),
    ];
    renderApp(server, "/");

    await heading(PRINTERS);
    expect(screen.getByText("rob")).toBeDefined();
    await waitFor(() => {
      expect(
        screen
          .getAllByRole("heading", { level: 2 })
          .map((each) => each.textContent),
      ).toEqual(["Sim 2", "Sim 10"]);
    });
    expect(screen.getByText("Error")).toBeDefined();
    expect(screen.getByText("Idle")).toBeDefined();
    expect(screen.getByRole("status").textContent).toBe("Live");
  });

  it("logs out: the socket closes and you land on the login page", async () => {
    const server = FakeServer.withUser({ loggedIn: true });
    const { app, user } = renderApp(server, "/");
    await waitFor(() => {
      expect(screen.getByRole("status").textContent).toBe("Live");
    });
    const socket = server.sockets.last;

    await user.click(screen.getByRole("button", { name: "Log out" }));

    await heading(LOGIN);
    expect(location(app)).toBe("/login");
    expect(server.requestsTo("POST /api/auth/logout")).toHaveLength(1);
    expect(socket.closedWith?.code).toBe(1000);
    expect(server.sockets.all).toHaveLength(1);
    expect(
      app.queryClient.getQueryData(sessionQuery(app.api).queryKey),
    ).toBeUndefined();
  });

  it("stays logged in and reconnects when logging out fails", async () => {
    const server = FakeServer.withUser({ loggedIn: true });
    const { app, user } = renderApp(server, "/");
    await waitFor(() => {
      expect(screen.getByRole("status").textContent).toBe("Live");
    });
    server.overrides.set("POST /api/auth/logout", () =>
      apiError(500, "internal", "Something went wrong on the server."),
    );

    await user.click(screen.getByRole("button", { name: "Log out" }));

    expect(
      await screen.findByText(
        "Couldn't log out: Something went wrong on the server.",
      ),
    ).toBeDefined();
    expect(location(app)).toBe("/");
    await waitFor(() => {
      expect(screen.getByRole("status").textContent).toBe("Live");
    });
    expect(server.sockets.all).toHaveLength(2);
  });

  it("goes to the login page when the session ends (4401), and back afterwards", async () => {
    const server = FakeServer.withUser({ loggedIn: true });
    const { app, user } = renderApp(server, "/?view=all");
    await waitFor(() => {
      expect(screen.getByRole("status").textContent).toBe("Live");
    });

    act(() => {
      server.endSession();
    });

    await heading(LOGIN);
    expect(location(app)).toBe("/login?redirect=%2F%3Fview%3Dall");
    await logIn(user);
    await heading(PRINTERS);
    expect(location(app)).toBe("/?view=all");
  });

  it("goes to the login page when a reconnect is refused because the session has gone", async () => {
    const server = FakeServer.withUser({ loggedIn: true });
    const { app } = renderApp(server, "/");
    await waitFor(() => {
      expect(screen.getByRole("status").textContent).toBe("Live");
    });

    act(() => {
      server.session = null;
      server.sockets.last.drop();
    });

    await heading(LOGIN);
    expect(location(app)).toBe("/login?redirect=%2F");
    expect(server.sockets.all).toHaveLength(2);
  });

  it.each([
    ["unauthenticated", "Log in first.", LOGIN, "/login?redirect=%2F"],
    ["setup_required", "No user exists yet.", SETUP, "/setup"],
  ] as const)(
    "goes where a REST answer of 401 %s says",
    async (code, message, page, where) => {
      const server = FakeServer.withUser({ loggedIn: true });
      const { app, visited } = renderApp(server, "/");
      await heading(PRINTERS);
      visited.length = 0;
      server.overrides.set("GET /api/printers", () =>
        apiError(401, code, message),
      );
      if (code === "setup_required") server.users = [];
      server.session = null;

      await act(() => app.api.client.GET("/api/printers"));

      await heading(page);
      expect(location(app)).toBe(where);
      expect(visited).toEqual([new URL(where, "http://app.invalid").pathname]);
    },
  );
});

describe("when the server can't be reached", () => {
  it.each([
    [
      "unreachable",
      "network",
      "Can't reach the server. Check that it's running, then try again.",
    ],
    [
      "down behind Vite's proxy (an empty 502)",
      "proxy",
      "The server answered with HTTP 502 and no explanation. Check that it's running, then try again.",
    ],
  ] as const)(
    "says so when it's %s, and tries again on request",
    async (_, mode, message) => {
      const server = FakeServer.withUser();
      server.mode = mode;
      const { app, user } = renderApp(server, "/");

      await heading("Something went wrong");
      expect(screen.getByText(message)).toBeDefined();
      expect(server.requestsTo("GET /api/auth/me")).toHaveLength(3);

      server.mode = "up";
      await user.click(screen.getByRole("button", { name: "Try again" }));

      await heading(LOGIN);
      expect(location(app)).toBe("/login?redirect=%2F");
    },
  );
});

describe("socketUrl", () => {
  it.each([
    ["http://localhost:5173", "ws://localhost:5173/api/ws"],
    ["https://printers.example:8443", "wss://printers.example:8443/api/ws"],
  ])("is /api/ws on the page's own origin (%s)", (origin, url) => {
    expect(socketUrl(origin)).toBe(url);
  });
});
