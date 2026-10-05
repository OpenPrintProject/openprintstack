// SPDX-FileCopyrightText: 2026 Open Print Stack contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import type {
  EventCategory,
  EventSource,
  EventType,
  OpsEvent,
} from "@openprintstack/protocol";
import {
  customType,
  index,
  integer,
  sqliteTable,
  text,
} from "drizzle-orm/sqlite-core";
import { z } from "zod";

// The database tables. Change this file, then generate a migration:
//   pnpm --filter @openprintstack/server db:generate --name <what_changed>
//
// All times are integer milliseconds since the Unix epoch. No column has a
// CHECK constraint: SQLite can only change one by rebuilding the table, so the
// repos validate values with Zod instead.

/**
 * Text that ignores case in every comparison and index: `text COLLATE NOCASE`.
 * Drizzle has no collation option, so it goes in the column type. NOCASE only
 * folds ASCII A–Z, so "É" and "é" still differ.
 */
const nocaseText = customType<{ data: string; driverData: string }>({
  dataType: () => "text COLLATE NOCASE",
});

export const UserRole = z.enum(["admin"]);

export type UserRole = z.infer<typeof UserRole>;

export const users = sqliteTable("users", {
  /** A UUIDv7. */
  id: text("id").primaryKey(),
  username: nocaseText("username").notNull().unique(),
  /** A PHC-style scrypt string, so it can be rehashed later. */
  passwordHash: text("password_hash").notNull(),
  role: text("role").$type<UserRole>().notNull().default("admin"),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
  lastLoginAt: integer("last_login_at"),
  disabledAt: integer("disabled_at"),
});

export const sessions = sqliteTable(
  "sessions",
  {
    /** sha256 of the session token. The raw token only ever lives in the cookie. */
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    createdAt: integer("created_at").notNull(),
    lastSeenAt: integer("last_seen_at").notNull(),
    expiresAt: integer("expires_at").notNull(),
    ip: text("ip"),
    userAgent: text("user_agent"),
  },
  (t) => [
    // For the cascade when a user is deleted, and for logging a user out
    // everywhere.
    index("sessions_user_id_idx").on(t.userId),
    // For the pruner, which deletes expired sessions.
    index("sessions_expires_at_idx").on(t.expiresAt),
  ],
);

/** A driver's settings: flat, like every driver's settings schema. */
export type PrinterSettings = Record<string, string | number | boolean>;

export const printers = sqliteTable("printers", {
  /** A UUIDv7, also the name of the printer's folder in the data dir. */
  id: text("id").primaryKey(),
  name: nocaseText("name").notNull().unique(),
  /** Can't change after the printer is created. */
  driverType: text("driver_type").notNull(),
  /**
   * Checked against the driver module's settings schema when written and when
   * loaded, by the driver host.
   */
  settings: text("settings", { mode: "json" })
    .$type<PrinterSettings>()
    .notNull(),
  /** 1 when created, plus one for every change to the settings. */
  settingsVersion: integer("settings_version").notNull().default(1),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

export const events = sqliteTable(
  "events",
  {
    /**
     * The paging cursor. AUTOINCREMENT means an id is never reused, even after
     * the newest rows are deleted.
     */
    rowId: integer("row_id").primaryKey({ autoIncrement: true }),
    /** The event's UUIDv7. */
    id: text("id").notNull().unique(),
    ts: integer("ts").notNull(),
    bootId: text("boot_id").notNull(),
    seq: integer("seq").notNull(),
    /** No foreign key, so history outlives deleted printers. */
    printerId: text("printer_id"),
    type: text("type").$type<EventType>().notNull(),
    category: text("category").$type<EventCategory>().notNull(),
    source: text("source").$type<EventSource["kind"]>().notNull(),
    /** Set when the source is a user. No foreign key, like `printer_id`. */
    userId: text("user_id"),
    correlationId: text("correlation_id"),
    payload: text("payload", { mode: "json" })
      .$type<OpsEvent["payload"]>()
      .notNull(),
  },
  (t) => [
    index("events_printer_id_ts_idx").on(t.printerId, t.ts),
    index("events_type_ts_idx").on(t.type, t.ts),
    index("events_category_ts_idx").on(t.category, t.ts),
    index("events_ts_idx").on(t.ts),
    index("events_correlation_id_idx").on(t.correlationId),
  ],
);
