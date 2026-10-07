// SPDX-FileCopyrightText: 2026 Open Print Stack contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { z } from "zod";

import { Id } from "./common.ts";
import { EventType, OpsEvent } from "./events.ts";
import { PrinterSnapshot } from "./state.ts";

// Messages on the WebSocket at /api/ws. Clients subscribe per topic; the server
// sends the topic's snapshot first, then its events.

export const FleetTopic = z
  .object({ name: z.literal("fleet") })
  .meta({ id: "FleetTopic" });

export const PrinterTopic = z
  .object({ name: z.literal("printer"), printerId: Id })
  .meta({ id: "PrinterTopic" });

/** The event log's live tail. Telemetry is left out unless asked for. */
export const EventsTopic = z
  .object({
    name: z.literal("events"),
    printerId: Id.optional(),
    types: z.array(EventType).optional(),
    includeTelemetry: z.boolean().optional(),
  })
  .meta({ id: "EventsTopic" });

export const Topic = z
  .discriminatedUnion("name", [FleetTopic, PrinterTopic, EventsTopic])
  .meta({ id: "Topic" });

export type Topic = z.infer<typeof Topic>;

/**
 * Identifies a subscription: two topics with the same key are one, for the
 * server's hub and the web app's reference counts alike. The events topic's
 * filters are compared by meaning, so the order and repeats of `types` don't
 * matter, an empty `types` is no filter, and a missing `includeTelemetry` is
 * false.
 */
export function topicKey(topic: Topic): string {
  switch (topic.name) {
    case "fleet":
      return "fleet";
    case "printer":
      return `printer:${topic.printerId}`;
    case "events":
      return `events:${JSON.stringify([
        topic.printerId ?? null,
        [...new Set(topic.types ?? [])].sort(),
        topic.includeTelemetry ?? false,
      ])}`;
  }
}

/**
 * Whether `event` belongs on `topic`: the rule the server's hub sends events
 * by (and the web app's tests' fake hub).
 *
 *   fleet        every event about a printer (printerId isn't null)
 *   printer:<id> every event about that printer
 *   events       every event, narrowed by its filters: printerId, types, and
 *                telemetry left out unless includeTelemetry is true or types
 *                names printer.telemetry (the rules of GET /api/events)
 */
export function matchesTopic(topic: Topic, event: OpsEvent): boolean {
  switch (topic.name) {
    case "fleet":
      return event.printerId !== null;
    case "printer":
      return event.printerId === topic.printerId;
    case "events": {
      if (
        topic.printerId !== undefined &&
        event.printerId !== topic.printerId
      ) {
        return false;
      }
      const types = topic.types ?? [];
      if (types.length > 0 && !types.includes(event.type)) return false;
      if (event.category === "telemetry") {
        return (
          topic.includeTelemetry === true || types.includes("printer.telemetry")
        );
      }
      return true;
    }
  }
}

// Client → server

export const WsClientMessage = z
  .discriminatedUnion("type", [
    z.object({ type: z.literal("subscribe"), topic: Topic }),
    z.object({ type: z.literal("unsubscribe"), topic: Topic }),
    z.object({ type: z.literal("ping") }),
  ])
  .meta({ id: "WsClientMessage" });

export type WsClientMessage = z.infer<typeof WsClientMessage>;

// Server → client

export const SessionUser = z
  .object({ id: Id, username: z.string().min(1) })
  .meta({ id: "SessionUser" });

export type SessionUser = z.infer<typeof SessionUser>;

const snapshotSeq = {
  /** The seq the snapshot is up to date with. Events after it follow. */
  seq: z.int().nonnegative(),
};

// A snapshot's data depends on its topic. Neither Zod's discriminated unions
// nor TypeScript's narrowing can key on a nested field like `topic.name`, so
// this is a plain union; use `WsSnapshotOf` for one topic's snapshot type.
export const WsServerMessage = z
  .union([
    z.object({ type: z.literal("hello"), bootId: Id, user: SessionUser }),
    z.object({
      type: z.literal("snapshot"),
      topic: FleetTopic,
      ...snapshotSeq,
      data: z.array(PrinterSnapshot),
    }),
    z.object({
      type: z.literal("snapshot"),
      topic: PrinterTopic,
      ...snapshotSeq,
      data: PrinterSnapshot,
    }),
    z.object({
      type: z.literal("snapshot"),
      topic: EventsTopic,
      ...snapshotSeq,
      /** History comes from `GET /api/events`; this only marks the seq. */
      data: z.null(),
    }),
    z.object({ type: z.literal("event"), topic: Topic, event: OpsEvent }),
    z.object({
      type: z.literal("error"),
      code: z.string().min(1),
      message: z.string(),
      /** The topic a refused subscribe was for, so the client knows which. */
      topic: Topic.optional(),
    }),
    z.object({ type: z.literal("pong") }),
  ])
  .meta({ id: "WsServerMessage" });

export type WsServerMessage = z.infer<typeof WsServerMessage>;

/** The snapshot message for one kind of topic, e.g. `WsSnapshotOf<"fleet">`. */
export type WsSnapshotOf<N extends Topic["name"]> = Extract<
  WsServerMessage,
  { type: "snapshot"; topic: { name: N } }
>;
