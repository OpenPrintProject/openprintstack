# Phase 0: Foundation, implementation plan

## Context

The project's development plan puts Phase 0 under every later phase. It has four parts:

- **Printer driver abstraction.** One interface that every printer brand implements.
- **Event bus and state store.** Every feature subscribes to it.
- **Data model.** Stored in SQLite.
- **Web UI shell.** Real-time updates and a single-user login.

Before Phase 0 the repo had no code. Phase 0 builds these pieces once, properly, and proves them end to end with a **simulated printer**, because real drivers don't arrive until Phase 1. When Phase 0 is done, you can run the app on macOS and do the following against simulated printers:

- create the admin account
- add printers
- watch their live state
- upload files and run prints
- inject faults
- browse a persisted event log

Every decision below was agreed during planning on 2026-10-05, and library facts were checked against current docs on the same date.

---

## Decisions

| Area             | Decision                                                                                                                                                                                                                                                                                                                          |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Runtime shape    | **Hybrid.** Everything runs in one Node process. The driver interface and event bus only pass plain serialisable messages, so drivers and heavy work can move to worker threads or child processes later without a rewrite.                                                                                                       |
| Stack            | TypeScript **6.0.x (pinned)**, **Node 26**, Hono, using the WebSocket support built into `@hono/node-server` v2. `@hono/node-ws` is deprecated.                                                                                                                                                                                   |
| Database         | SQLite through **better-sqlite3 13** and **Drizzle ORM 0.45** (stable). Drizzle-kit generates the SQL migrations.                                                                                                                                                                                                                 |
| API              | JSON REST defined with Zod 4 via `@hono/zod-openapi`, which generates `openapi.json`. The web app uses this same API through `openapi-typescript`, `openapi-fetch` and `openapi-react-query`.                                                                                                                                     |
| Real-time        | WebSocket at `/api/ws`, with a subscribe-per-topic model. It authenticates with the session cookie and checks the request's Origin.                                                                                                                                                                                               |
| Frontend         | React SPA built with Vite, TanStack Router + Query + **Form**, Tailwind v4 and shadcn/ui.                                                                                                                                                                                                                                         |
| Repo             | pnpm workspaces. Packages use the `@openprintstack/*` scope.                                                                                                                                                                                                                                                                      |
| Tooling          | Vitest only (no Playwright), ESLint (flat config) and Prettier.                                                                                                                                                                                                                                                                   |
| CI               | GitHub Actions on every PR. The main checks run on Linux, plus a macOS test job, both on Node 26.                                                                                                                                                                                                                                 |
| Platform         | macOS only in Phase 0.                                                                                                                                                                                                                                                                                                            |
| Network          | Plain HTTP; Phase 8 adds HTTPS. Listens on **`127.0.0.1:7337`** by default. Change with `OPS_HOST` and `OPS_PORT`.                                                                                                                                                                                                                |
| Data directory   | `~/Library/Application Support/open-print-stack` (via `env-paths` with `suffix: ''`). Override with `OPS_DATA_DIR`. All env vars use the `OPS_` prefix.                                                                                                                                                                           |
| Logging          | pino writing JSON to stdout. Pretty-printed in dev. Passwords and cookies are redacted.                                                                                                                                                                                                                                           |
| Driver interface | Full scope: connect, status stream, send and list files, start/pause/resume/cancel, home and move, temperatures, fans, list cameras and take snapshots, plus capability flags. The simulator implements all of it.                                                                                                                |
| Statuses         | connecting, offline, idle, busy, preparing, printing, pausing, paused, cancelling, error                                                                                                                                                                                                                                          |
| Units            | °C, mm and seconds. Progress and fans are 0–100 percent. **Speed percent can go above 100.** `null` means the printer doesn't report that value; it never means 0.                                                                                                                                                                |
| Safety           | One central check rejects out-of-limit commands before they reach the driver: temperatures above `maxC`, moves outside the build volume, and too-high speeds. Jogs are **relative moves only, and refused until the axes are homed and the position is known**.                                                                   |
| Offline commands | Fail immediately. Commands are never queued.                                                                                                                                                                                                                                                                                      |
| Restart          | The state store starts empty, so every printer shows `connecting` until its driver reports in.                                                                                                                                                                                                                                    |
| Events           | Everything is persisted, including the user's commands (requested + result, with user id). Telemetry is written **at most every 5 s per printer** (the last value in each window is kept) and **pruned after 7 days**; both are configurable. All other events are kept. The live UI still receives every update.                 |
| Tables           | Only `users`, `sessions`, `printers` and `events`. Files, jobs and spools wait for their own phases.                                                                                                                                                                                                                              |
| Auth             | The `users` table supports multiple users but has one row in Phase 0. A first-run browser setup screen creates the admin, with **no setup token** and a password of at least 12 characters. Passwords are hashed with scrypt (`node:crypto`). Login uses an HttpOnly cookie backed by DB sessions, on a **7-day sliding** expiry. |
| Simulator        | Configurable print duration and speed multiplier. The camera gives a generated PNG snapshot only. Faults are triggered from a UI panel or the API.                                                                                                                                                                                |
| Printer edits    | Renaming applies straight away. Settings changes restart the driver, and are **refused (409) while a job is active** (preparing, printing, pausing, paused or cancelling).                                                                                                                                                        |
| Licence headers  | Every source file, **including vendored shadcn components**, starts with `SPDX-FileCopyrightText: 2026 Open Print Stack contributors` and `SPDX-License-Identifier: AGPL-3.0-or-later`. shadcn's MIT notice is kept in `THIRD_PARTY_NOTICES.md`, as the MIT licence requires.                                                     |
| Delivery         | One PR per component (list below). PR 1 copies this plan into `docs/phase-0.md`.                                                                                                                                                                                                                                                  |

---

## Monorepo layout

```
package.json  pnpm-workspace.yaml (catalog: one zod/typescript/vitest version; allowBuilds)
tsconfig.base.json  eslint.config.js  prettier.config.js  vitest.config.ts (test.projects)
.node-version (26)  REUSE.toml  LICENSES/  .github/workflows/ci.yml  docs/phase-0.md
THIRD_PARTY_NOTICES.md (added in PR 10 with the first shadcn components)
packages/
  protocol/          Zod schemas and types shared by everything; safe to run in the browser; only depends on zod
                     (status, capabilities, telemetry/state, commands + COMMAND_POLICY, event envelope and
                      catalogue, WS messages, API error DTO, reducePrinterState: the pure reducer used by server AND web)
  driver-sdk/        PrinterDriver/DriverModule contract, DriverError, host↔driver wire messages,
                     transport abstraction + cloning loopback, conformance test kit
  driver-simulated/  simulated printer, PNG snapshot generator, "simulator" fault extension
apps/
  server/            config, logger, db, bus, state store, persistence/pruner, driver host + registry,
                     command service + safety, auth, REST routes, WS hub, SPA serving
    drizzle/         generated migrations (committed)   openapi.json (generated, committed, CI checks for drift)
  web/               React SPA
```

**Import boundaries.** ESLint's `no-restricted-imports` rule enforces these:

- `protocol` can't import `node:*` or any other workspace package.
- Drivers can't import server, Hono or DB code.
- `web` can't import `node:*`, any driver package or the server.
- **In the server, only `drivers/registry.ts` may import `@openprintstack/driver-*`.** This enforces the rule that "every feature talks to the interface".

**Builds.** Workspace packages export their TypeScript source directly. `tsx` runs it in dev and Vite bundles it for the web. For production, `tsdown` bundles the server and inlines the workspace packages.

---

## Core design

### Driver interface (`packages/driver-sdk`, `packages/protocol`)

**What a driver module provides:**

- a `manifest`
- a flat Zod `settingsSchema`, which the UI renders as a generic form via `z.toJSONSchema`
- `initialCapabilities(settings)`
- `create(init, ctx)`, which returns a `PrinterDriver`

**`PrinterDriver` methods.** Each is async and takes plain-object requests:

| Area          | Methods                                                                                                                      |
| ------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Connection    | `connect` (handles reconnecting itself; reports `offline` rather than throwing on network failures), `disconnect`, `dispose` |
| Files         | `listFiles`, `sendFile`                                                                                                      |
| Printing      | `startPrint`, `pause`, `resume`, `cancel`                                                                                    |
| Motion        | `home`, `move`                                                                                                               |
| Heat and fans | `setTemperature`, `setFan`                                                                                                   |
| Cameras       | `listCameras`, `getSnapshot`                                                                                                 |
| Extensions    | `invokeExtension?` (optional)                                                                                                |

**Errors.** Failures throw a `DriverError` with one of these codes: `not_supported`, `invalid_state`, `offline`, `timeout`, `file_not_found`, `printer_rejected`, `internal`.

**Reporting state.** Drivers send everything out through `ctx.emit(DriverMessage)`. The message types are:

| Message         | What it reports                                                      |
| --------------- | -------------------------------------------------------------------- |
| `status`        | status, detail and error                                             |
| `telemetry`     | only the fields that changed                                         |
| `job`           | current job details                                                  |
| `job_lifecycle` | job started, completed, cancelled or failed                          |
| `capabilities`  | the printer's capabilities, which may only be known after connecting |
| `files_changed` | the printer's file list changed                                      |
| `alert`         | e.g. filament runout                                                 |
| `log`           | goes to pino, not the event bus                                      |

**Capabilities** declare:

- supported command kinds
- heaters (`id`, `kind`, `label`, `maxC`)
- fans (`id`, `kind`, `controllable`)
- axis limits (build volume)
- `maxMoveSpeedMmS`
- file rules (`list`, `upload`, `acceptedExtensions`, `maxUploadBytes`)
- cameras (`snapshot`, with `stream` false until Phase 2)
- extensions (e.g. `simulator`)

The UI hides any control that a printer's capabilities don't include.

**How the serialisable boundary is enforced:**

- Host↔driver traffic goes through a `DriverTransport`. In Phase 0 this is a loopback that runs `structuredClone` on every message in dev and test, which behaves exactly like `postMessage`. Moving drivers to workers later only means swapping the transport.
- The host Zod-parses every message it receives.
- Type tests assert that every message is `Serializable`: no `Date`, `Map` or functions, and timestamps are ISO strings.
- `describeDriverConformance(module, fixture)` runs every driver through the cloning transport.

**Registry.** `apps/server/src/drivers/registry.ts` maps each driver type to a string module specifier, which it loads with dynamic `import()` (workers can load the same specifier later). `GET /api/driver-types` returns each type's settings JSON Schema and defaults.

### Event bus and state store (`apps/server/src/bus`, `state`)

**Event envelope fields:**

- `id`: UUIDv7
- `ts`: ISO time
- `seq`: monotonic
- `bootId`
- `printerId`: nullable
- `type` and `category`: category is one of telemetry, state, command, config, auth, system
- `source`: driver, user + userId, or system
- `correlationId`: the commandId, on command events
- `payload`: typed by event type

**Phase 0 event catalogue:**

| Category  | Events                                                                                                                                         |
| --------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Telemetry | `printer.telemetry` (the full merged telemetry, not a patch)                                                                                   |
| State     | `printer.status_changed`, `printer.capabilities_changed`, `printer.alert`, `printer.job_started`, `printer.job_ended`, `printer.files_changed` |
| Command   | `command.requested`, `command.result`                                                                                                          |
| Config    | `printer.added`, `printer.updated`, `printer.removed`                                                                                          |
| Auth      | `auth.setup_completed`, `auth.login_succeeded`, `auth.login_failed`, `auth.logout`                                                             |
| System    | `system.started`, `system.stopping`                                                                                                            |

**How the bus behaves:**

- The host converts each `DriverMessage` into an event and stamps the envelope. Drivers never create ids or timestamps.
- `publish()` checks the event (Zod, in dev and test), applies it to the state store first, and then runs each subscriber synchronously in order.
- If a subscriber publishes during dispatch, that event is queued and processed after the current one, in first-in-first-out order.
- Each subscriber runs inside try/catch, so one failure doesn't stop the rest.
- Ordering is total, which means it's also per printer.

**State store.**

- `Map<printerId, PrinterSnapshot>`, updated by the shared `reducePrinterState`.
- Starts empty on boot. The server publishes `status_changed → connecting` for each printer before starting its driver.

### Persistence (`apps/server/src/events/persistence.ts`, `pruner.ts`)

- **Non-telemetry events.** Queued, then written in one transaction per `setImmediate` tick.
- **Telemetry.** A throttle slot per printer:
  - Write immediately if at least `OPS_TELEMETRY_SAMPLE_INTERVAL_MS` (5000) has passed since the last write.
  - Otherwise hold the newest value and write it when a trailing timer fires.
  - Flush straight away when a printer goes offline, is removed, or the server shuts down.
- **Pruner.** Runs at startup and then every hour. Deletes telemetry older than `OPS_TELEMETRY_RETENTION_DAYS` (7) in batches, and also deletes expired sessions.
- **SQLite settings.** WAL mode, `synchronous=NORMAL`, `foreign_keys=ON`, `busy_timeout=5000`.

### Command path (`apps/server/src/commands/command-service.ts`, `safety.ts`)

`POST /api/printers/{id}/commands` handles each command in order:

1. Check the session and that the printer exists.
2. Publish `command.requested`.
3. Take a per-printer mutex (one command at a time; this is not a queue).
4. Check the command is in the printer's capabilities (`unsupported`, 422).
5. Check the printer is online (`printer_offline`, 409, immediately).
6. Check `COMMAND_POLICY.allowedStatuses` (`invalid_state`, 409).
7. Run the safety check (`unsafe`, 422).
8. Call the driver, with a 10 s timeout (10 min for uploads).
9. Publish `command.result` and respond.

**File uploads.** `PUT /api/printers/{id}/files/{fileName}` checks policy, online state, the filename and size **before** reading the body. It then streams the body to `staging/` and runs the `file.upload` command.

**Simulator routes.** `/api/printers/{id}/simulator/*` covers faults, clear and speed. Each maps to `extension.invoke`.

### WebSocket hub (`apps/server/src/ws/hub.ts`)

**Connecting.** The upgrade at `/api/ws` runs session middleware first (401 if not logged in), then the Origin check. `maxPayload` is 64 KB.

**Messages:**

- **Client → server:** `subscribe` and `unsubscribe` for these topics:
  - `fleet`
  - `printer:<id>`
  - `events` (optional filters; telemetry excluded by default)
- **Server → client:** `hello{bootId,user}`, `snapshot`, `event`, `error`, `pong`.

**Rules:**

- **Snapshot before events.** A topic's snapshot is read and the topic registered in the same tick, so no event falls in the gap.
- **Backpressure.** If a socket's buffer goes over 1 MiB, telemetry to it is dropped and the topic resyncs once the buffer drains.
- **Keep-alive.** Ping every 30 s.
- **Logout** closes that session's sockets with code 4401.

### Database schema (`apps/server/src/db/schema.ts`)

All times are integer milliseconds.

| Table      | Columns                                                                                                                                                                                                               | Notes                                                                                                      |
| ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `users`    | `id` (uuidv7), `username` (unique NOCASE), `password_hash` (PHC-style scrypt string so it can be rehashed later), `role` (default `admin`), `created_at`, `updated_at`, `last_login_at`, `disabled_at`                |                                                                                                            |
| `sessions` | `id` = sha256(token), `user_id` (FK, cascade), `created_at`, `last_seen_at`, `expires_at`, `ip`, `user_agent`                                                                                                         | The raw token only ever lives in the cookie. The sliding expiry is written to the DB at most once an hour. |
| `printers` | `id`, `name` (unique NOCASE), `driver_type` (can't change), `settings` (JSON, checked against the module's schema when written and when loaded), `settings_version`, `created_at`, `updated_at`                       |                                                                                                            |
| `events`   | `row_id` (autoincrement, used as the paging cursor), `id` (unique), `ts`, `printer_id` (**no FK**, so history outlives deleted printers), `type`, `category`, `source`, `user_id`, `correlation_id`, `payload` (JSON) | Indexes on (`printer_id`,`ts`), (`type`,`ts`), (`category`,`ts`), `ts` and `correlation_id`                |

**Migrations.** The server runs Drizzle migrations at startup, before anything else. CI regenerates the migrations and fails if they differ from what's committed.

---

## PR sequence

Each PR adds its own tests, and CI must be green before it merges.

1. **Scaffold, CI and plan doc.**
   - **Scope:** root config, catalog and `allowBuilds`, ESLint boundary rules, Vitest projects, `REUSE.toml` and `LICENSES/`, the CI workflow, a `protocol` package holding only `PrinterStatus` and its smoke test, and `docs/phase-0.md` (this plan).
   - **CI steps:** `install --frozen-lockfile`, `format:check`, `lint`, `typecheck`, `test`, `build`, `reuse lint`, plus a macOS job that runs `test`.
2. **`protocol`.**
   - **Scope:** all schemas, `COMMAND_POLICY`, the event→category table and `reducePrinterState`.
   - **Tests:** the reducer, `structuredClone` and JSON round trips, `Serializable` type tests, and that the policy covers every command kind.
3. **`driver-sdk`.**
   - **Scope:** the contract, `DriverError`, dispatch, the transport and cloning loopback, the driver endpoint, and the conformance kit.
   - **Tests:** a fake driver passes. Emitting a `Date` or a function fails. An unknown op returns `not_supported`.
4. **`driver-simulated`.**
   - **Settings and defaults:**

     | Setting                | Default     |
     | ---------------------- | ----------- |
     | `printDurationS`       | 600         |
     | `speedMultiplier`      | 1           |
     | `heatUpS`              | 20          |
     | `nozzleMaxC`           | 300         |
     | `bedMaxC`              | 120         |
     | build volume (X, Y, Z) | 256 mm each |
     | `maxMoveSpeedMmS`      | 200         |
     | `cameraEnabled`        | true        |

   - **Simulation:** ticks every 500 ms, multiplied by the speed setting. Temperatures lag behind their targets.
   - **Status flow:**
     - Print: preparing → printing → completed → idle.
     - Pause goes through pausing, cancel through cancelling, and home through busy.
   - **Files:** stored in its own folder in the data dir.
   - **Camera:** a PNG built with `node:zlib`.
   - **`simulator` extension actions:** `fault.error`, `fault.filament_runout` (pauses and raises an alert), `fault.disconnect{durationS}`, `clear` and `set_speed`.
   - **Tests:** conformance plus fake-timer scenarios.
5. **Server: config, logger, paths and database.**
   - **Scope:** Zod-validated `OPS_*` config, pino with redaction, the data-dir layout (`ops.sqlite`, `printers/<id>/`, `staging/`), the schema, client, migrator and repos, and the first migration.
   - **Check:** better-sqlite3 13 installs from prebuilt binaries on Node 26.
6. **Server: bus, state store, persistence and pruner.**
   - **Tests:** ordering, re-entrancy, isolating a subscriber that throws, store-before-subscribers, the throttle (fake timers), and that the pruner deletes telemetry only.
7. **Server: driver host, registry, printer lifecycle, commands and safety.**
   - **Lifecycle:** drivers start on boot and when a printer is added. They restart when settings are edited, and that edit is refused while a job is active. They stop and their storage is removed when a printer is deleted.
   - **Tests:** tables of safety cases, an offline printer is rejected immediately and both command events are recorded, invalid state, the mutex, and a malformed driver message raises an alert.
8. **Server: HTTP app, auth and OpenAPI.**
   - **Middleware:** `defaultHook` returns 400 `validation_failed`. Also `bodyLimit`, secure headers (except on `/api/ws`), and an Origin check on unsafe methods.
   - **Auth:** setup, login, logout and me. The cookie is `ops_session`: HttpOnly, SameSite=Lax, 7 days. Login also gets a basic in-memory backoff.
   - **Resources:** driver-types, printers CRUD, commands, files, cameras and snapshot, simulator, paged `GET /api/events`, and `/api/openapi.json`. An `emit-openapi` script writes the committed spec.
   - **Tests:** the full auth flow, a second setup returns 409, 11-character password rejected and 12 accepted, cross-origin POST rejected, and no spec drift.
9. **Server: WebSocket hub and `main.ts`.**
   - **Boot order:** config → logger → db and migrate → bus and store → persistence → printers → http and ws → `system.started`. SIGINT/SIGTERM shut down gracefully.
   - **Tests:** 401 without a cookie, bad Origin rejected, snapshot arrives before events, logout gives 4401, backpressure resync.
   - **End-to-end test:** a simulated printer at 1000× speed, upload → start → idle, then check `job_ended` and the command events in the DB.
10. **Web shell.**
    - **Tooling:** Vite (`tanstackRouter()` before `react()`, then `tailwindcss()`), with `/api` and the WebSocket proxied to `127.0.0.1:7337`. shadcn init uses `paths` only. TanStack Form is wired to shadcn's field primitives.
    - **API client:** generated from the OpenAPI spec. A 401 redirects to `/login`.
    - **Routes:** `/setup`, `/login` and an `_authed` layout.
    - **`RealtimeProvider`:** one socket with backoff, reference-counted topics, resubscribing on reconnect, and a reset when `bootId` changes. Events update the Query cache through `reducePrinterState`.
11. **Web: printers.**
    - **List:** printers with live status.
    - **Add and edit:** a generic form generated from the driver's settings schema.
    - **Delete:** with confirmation.
    - **Detail page:**
      - print controls
      - jog and home
      - temperatures (capped at `maxC`)
      - fans
      - files with upload
      - camera snapshot with refresh
      - Simulator panel, shown only when the printer has the `simulator` extension
    - Controls are shown or hidden from capabilities and `COMMAND_POLICY`. Errors appear as toasts.
12. **Web: event log.**
    - Infinite list paged by cursor.
    - Printer and type filters kept in search params.
    - An "include telemetry" toggle and a live tail of new events.
    - Command rows show the user.
13. **Production serving and docs.**
    - **Serving:** the server serves `apps/web/dist` and falls back to `index.html` for the SPA. `pnpm build && pnpm start` runs everything on :7337.
    - **Docs:** fill in the README's Getting Started and Project Structure sections.

---

## Verification

**Prerequisites.** Install **Node 26**, which `.node-version` pins (for example with fnm, which reads that file). Node 26 no longer bundles corepack, so install pnpm with `npm install -g pnpm@12`. pnpm then switches itself to the exact version in `packageManager`.

**Automated checks.** `pnpm lint && pnpm typecheck && pnpm test && pnpm build` must pass locally and in CI on Linux and macOS.

| Area                                     | Tests that prove it              |
| ---------------------------------------- | -------------------------------- |
| Serialisable boundary                    | Conformance tests and type tests |
| Ordering and isolation                   | Bus tests                        |
| Throttle and pruning                     | Fake-timer tests                 |
| Safety, offline and state rules          | Command-service tables           |
| Auth and sessions                        | HTTP tests                       |
| WebSocket auth and snapshot-then-delta   | Hub tests                        |
| Whole system                             | In-process end-to-end test       |
| UI capability gating and realtime client | Component and unit tests         |
| Spec and migration drift                 | CI checks                        |

**Manual walkthrough.** Run `pnpm dev` (server on :7337, Vite on :5173), then open http://localhost:5173.

1. Setup screen: an 11-character password is rejected. Create the admin.
2. Add a simulated printer at ×60 speed. It shows connecting, then idle.
3. Upload a `.gcode` file. It appears in the printer's file list.
4. Start the print and watch: preparing (temperatures rise), then printing with progress. Pause, resume, then cancel.
5. Safety checks:
   - Set the nozzle to 400 °C: rejected as unsafe.
   - Jog before homing: rejected.
   - Home, then jog: works.
6. The camera snapshot renders.
7. Simulator panel:
   - **Filament runout:** the printer pauses and an alert appears.
   - **Error:** the printer goes to error; **Clear** returns it to idle.
   - **Disconnect 15 s:** the printer goes offline and commands fail instantly with `printer_offline`. It then reconnects automatically.
8. The event log shows the command events with your username. Filters and the telemetry toggle work.
9. Restart the server. Printers show connecting, then live state, and the history is still there.
10. Editing a printer's settings while it's printing is refused. Renaming works.
11. Log out. The socket closes and you land on the login page.
12. Check the database:
    ```bash
    sqlite3 ~/Library/Application\ Support/open-print-stack/ops.sqlite 'select type,count(*) from events group by 1'
    ```
