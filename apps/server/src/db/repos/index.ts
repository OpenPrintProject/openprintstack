// SPDX-FileCopyrightText: 2026 Open Print Stack contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { Db } from "../client.ts";
import { EventsRepo } from "./events.ts";
import { PrintersRepo } from "./printers.ts";
import { SessionsRepo } from "./sessions.ts";
import { UsersRepo } from "./users.ts";

export { EventsRepo, PrintersRepo, SessionsRepo, UsersRepo };
export type { NewPrinter, Printer, PrinterChanges } from "./printers.ts";
export type { NewSession, Session } from "./sessions.ts";
export type { NewUser, User } from "./users.ts";

/** Every repo. Each function is synchronous, like better-sqlite3. */
export type Repos = {
  readonly users: UsersRepo;
  readonly sessions: SessionsRepo;
  readonly printers: PrintersRepo;
  readonly events: EventsRepo;
};

export function createRepos(db: Db): Repos {
  return {
    users: new UsersRepo(db),
    sessions: new SessionsRepo(db),
    printers: new PrintersRepo(db),
    events: new EventsRepo(db),
  };
}
