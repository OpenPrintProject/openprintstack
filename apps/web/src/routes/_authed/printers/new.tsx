// SPDX-FileCopyrightText: 2026 Open Print Stack contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { createFileRoute } from "@tanstack/react-router";

import { AddPrinterPage } from "../../../printers/add-printer-page.tsx";

export const Route = createFileRoute("/_authed/printers/new")({
  component: AddPrinterPage,
});
