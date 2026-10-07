// SPDX-FileCopyrightText: 2026 Open Print Stack contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { createFileRoute } from "@tanstack/react-router";

import { PrinterPage } from "../../../../printers/printer-page.tsx";

export const Route = createFileRoute("/_authed/printers/$printerId/")({
  component: PrinterRoute,
});

function PrinterRoute() {
  const { printerId } = Route.useParams();
  // A page per printer: nothing carries over from another one.
  return <PrinterPage key={printerId} printerId={printerId} />;
}
