// SPDX-FileCopyrightText: 2026 Open Print Stack contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { createFileRoute } from "@tanstack/react-router";
import { useMemo } from "react";

import { EventLogPage } from "../../events/event-log-page.tsx";
import {
  EventLogSearch,
  eventLogSearch,
  filtersOf,
} from "../../events/filters.ts";

export const Route = createFileRoute("/_authed/events")({
  validateSearch: EventLogSearch,
  component: EventLogRoute,
});

function EventLogRoute() {
  const search = Route.useSearch();
  const filters = useMemo(() => filtersOf(search), [search]);
  const { user } = Route.useRouteContext();
  const navigate = Route.useNavigate();
  return (
    <EventLogPage
      filters={filters}
      sessionUser={user}
      onFiltersChange={(next) => {
        // Replaced, not pushed: the back button leaves the log rather than
        // stepping through every checkbox.
        void navigate({ search: eventLogSearch(next), replace: true });
      }}
    />
  );
}
