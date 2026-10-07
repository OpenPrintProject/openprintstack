// SPDX-FileCopyrightText: 2026 Open Print Stack contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { createFileRoute } from "@tanstack/react-router";

import { PrinterList } from "../../printers/printer-list.tsx";

export const Route = createFileRoute("/_authed/")({
  component: PrinterList,
});
