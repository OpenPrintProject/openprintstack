// SPDX-FileCopyrightText: 2026 Open Print Stack contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { z } from "zod";

// Zod checks whether it may compile parsers with `new Function`, the first
// time an object schema is built. The page's Content-Security-Policy forbids
// that, so the check fails (Zod falls back), but the browser still reports
// a violation. `jitless` skips the check. Zod reads it as each schema is
// built, which for protocol's schemas is when it's imported, so main.tsx
// imports this module before anything else, and the build keeps that order
// (`strictExecutionOrder` in vite.config.ts).

z.config({ jitless: true });
