// SPDX-FileCopyrightText: 2026 Open Print Stack contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { OpsEvent, Topic } from "@openprintstack/protocol";

// Which events each WebSocket topic carries. Which topics are the same
// subscription is protocol's `topicKey`, which the web app shares.
//
//   fleet        every event about a printer (printerId isn't null)
//   printer:<id> every event about that printer
//   events       every event, narrowed by its filters: printerId, types, and
//                telemetry left out unless includeTelemetry is true or types
//                names printer.telemetry (the rules of GET /api/events)

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
