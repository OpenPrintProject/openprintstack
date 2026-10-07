// SPDX-FileCopyrightText: 2026 Open Print Stack contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

// First, before anything builds a Zod schema (see the module).
import "./zod-config.ts";
import "./styles/index.css";

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { AppRoot, createApp } from "./app.tsx";

const root = document.getElementById("root");
if (root === null) throw new Error("index.html has no #root element.");

const app = createApp({ origin: window.location.origin });

createRoot(root).render(
  <StrictMode>
    <AppRoot app={app} />
  </StrictMode>,
);
