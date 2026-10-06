// SPDX-FileCopyrightText: 2026 Open Print Stack contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { OpsEvent, Topic } from "@openprintstack/protocol";

// Which events each WebSocket topic carries, and when two topics are the same
// subscription.
//
//   fleet        every event about a printer (printerId isn't null)
//   printer:<id> every event about that printer
//   events       every event, narrowed by its filters: printerId, types, and
//                telemetry left out unless includeTelemetry is true or types
//                names printer.telemetry (the rules of GET /api/events)

/**
 * Identifies a subscription: two topics with the same key are one. The events
 * topic's filters are compared by meaning, so the order and repeats of
 * `types` don't matter, an empty `types` is no filter, and a missing
 * `includeTelemetry` is false.
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

/** Whether `event` belongs on `topic`. */
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
