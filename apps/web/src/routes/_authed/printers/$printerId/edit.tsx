// SPDX-FileCopyrightText: 2026 Open Print Stack contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { createFileRoute } from "@tanstack/react-router";

import { EditPrinterPage } from "../../../../printers/edit-printer-page.tsx";

export const Route = createFileRoute("/_authed/printers/$printerId/edit")({
  component: EditPrinterRoute,
});

function EditPrinterRoute() {
  const { printerId } = Route.useParams();
  return <EditPrinterPage key={printerId} printerId={printerId} />;
}
