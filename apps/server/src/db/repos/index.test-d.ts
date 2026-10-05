// SPDX-FileCopyrightText: 2026 Open Print Stack contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { OpsEvent, Serializable } from "@openprintstack/protocol";
import { describe, expectTypeOf, it } from "vitest";

import type { PrinterSettings } from "../schema.ts";
import type {
  EventsRepo,
  Printer,
  PrintersRepo,
  Session,
  SessionsRepo,
  User,
  UsersRepo,
} from "./index.ts";

describe("rows", () => {
  it("hold times as millisecond numbers, never Dates", () => {
    expectTypeOf<User["createdAt"]>().toEqualTypeOf<number>();
    expectTypeOf<User["lastLoginAt"]>().toEqualTypeOf<number | null>();
    expectTypeOf<Session["expiresAt"]>().toEqualTypeOf<number>();
    expectTypeOf<Printer["updatedAt"]>().toEqualTypeOf<number>();
  });

  it("type the role, settings and nullable columns", () => {
    expectTypeOf<User["role"]>().toEqualTypeOf<"admin">();
    expectTypeOf<Printer["settings"]>().toEqualTypeOf<PrinterSettings>();
    expectTypeOf<Session["ip"]>().toEqualTypeOf<string | null>();
  });

  it("are serialisable, so they can cross a worker boundary", () => {
    expectTypeOf<User>().toExtend<Serializable>();
    expectTypeOf<Session>().toExtend<Serializable>();
    expectTypeOf<Printer>().toExtend<Serializable>();
  });
});

describe("repos", () => {
  it("are synchronous, like better-sqlite3", () => {
    expectTypeOf<UsersRepo["create"]>().returns.toEqualTypeOf<User>();
    expectTypeOf<UsersRepo["findByUsername"]>().returns.toEqualTypeOf<
      User | undefined
    >();
    expectTypeOf<SessionsRepo["findById"]>().returns.toEqualTypeOf<
      Session | undefined
    >();
    expectTypeOf<PrintersRepo["create"]>().returns.toEqualTypeOf<Printer>();
    expectTypeOf<EventsRepo["insertMany"]>().returns.toEqualTypeOf<void>();
  });

  it("read and write protocol's events", () => {
    expectTypeOf<EventsRepo["insertMany"]>()
      .parameter(0)
      .toEqualTypeOf<readonly OpsEvent[]>();
    expectTypeOf<EventsRepo["findById"]>().returns.toEqualTypeOf<
      OpsEvent | undefined
    >();
  });
});
