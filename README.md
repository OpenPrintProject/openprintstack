# Open Print Stack

> **3D print management that's yours.** Self-hosted, private and free for everyone, whether you run one 3D printer or a hundred.

## Overview

Printing shouldn't mean handing your files to someone else's cloud, signing up for a subscription or living with a tool that only works at one scale.

Open Print Stack is a 3D print management tool that runs entirely on your own hardware:

- **Completely self-hosted.** It runs on your own infrastructure, with no external services required.
- **Private by design.** Your print jobs and data never leave your network.
- **Free for everyone.** It's open source under the AGPL, with no licence fees, paid tiers or feature paywalls.
- **Built to scale.** It works just as well for a single printer at home as for a fleet of 100 across an organisation.

## Features

- _Planned or available feature_

## Getting Started

Open Print Stack is in its first phase: the foundations, proved end to end with simulated printers. Drivers for real printers come next.

### Prerequisites

- **macOS or Windows (x64).** They're the only platforms supported so far.
- **Node.js 26.** The repository's `.node-version` file names it, so a version manager that reads that file picks it up. With [fnm](https://github.com/Schniz/fnm), run `fnm install` and then `fnm use` in the repository.
- **pnpm 12.** Node 26 no longer includes corepack, so install pnpm with npm:

  ```bash
  npm install -g pnpm@12
  ```

  pnpm then switches itself to the exact version this repository asks for.

### Installation

```bash
git clone https://github.com/OpenPrintProject/openprintstack.git
cd openprintstack
pnpm install
```

### Usage

Build it, then start it:

```bash
pnpm build
pnpm start
```

Then open <http://localhost:7337>. The first time, a setup screen creates the admin account (the password needs at least 12 characters). After that, add a printer: the simulated one behaves like a real printer, with temperatures, prints, a camera and faults you can trigger.

`pnpm build` makes the web app (`apps/web/dist`) and the server (`apps/server/dist`); `pnpm start` runs the server, which serves the web app as well as the API. Run `pnpm build` again after pulling changes, then restart.

**For development**, run both with live reloading instead:

```bash
pnpm dev
```

Then open <http://localhost:5173>, where Vite serves the web app and passes `/api` to the server on port 7337. The server restarts when its code changes, and pretty-prints its logs.

#### Settings

Settings are environment variables, for example `OPS_PORT=8080 pnpm start` (in PowerShell, `$env:OPS_PORT=8080; pnpm start`). The server refuses to start if one is invalid, or if an `OPS_` variable isn't one it knows.

| Variable                           | Default                                  | What it does                                                                                                                                                                                   |
| ---------------------------------- | ---------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `OPS_HOST`                         | `127.0.0.1`                              | The address to listen on. `127.0.0.1` keeps it to this computer; `0.0.0.0` lets other devices on your network in. It's plain HTTP for now, so only do that on a network you trust.             |
| `OPS_PORT`                         | `7337`                                   | The port to listen on. `0` takes any free port, which the log names.                                                                                                                           |
| `OPS_ALLOWED_HOSTS`                | (none)                                   | Other names the server answers to, separated by commas, such as `printers.local,192.168.1.20`. It always answers to `localhost`, `127.0.0.1`, `[::1]` and `OPS_HOST`, and refuses other names. |
| `OPS_DATA_DIR`                     | your user's app data (see [Data](#data)) | Where everything is stored (below). With `pnpm start` and `pnpm dev`, a relative path is taken from the repository's root, whichever folder you run them in; `~` isn't expanded.               |
| `OPS_LOG_LEVEL`                    | `info`                                   | `silent`, `fatal`, `error`, `warn`, `info`, `debug` or `trace`. Logs are JSON lines on stdout.                                                                                                 |
| `OPS_ENV`                          | `production`                             | `development` (which `pnpm dev` sets) pretty-prints the logs and adds extra checks; `test` adds the checks only.                                                                               |
| `OPS_TELEMETRY_SAMPLE_INTERVAL_MS` | `5000`                                   | How often each printer's temperatures and progress are stored, at most. `0` stores every update. The live view always gets every update.                                                       |
| `OPS_TELEMETRY_RETENTION_DAYS`     | `7`                                      | How long stored telemetry is kept. Every other event is kept.                                                                                                                                  |

#### Data

Everything the server stores is in its data directory, which by default is `~/Library/Application Support/open-print-stack` on macOS and `%LOCALAPPDATA%\open-print-stack` on Windows:

| Path             | What it is                                                                    |
| ---------------- | ----------------------------------------------------------------------------- |
| `ops.sqlite`     | The database (with `ops.sqlite-wal` and `ops.sqlite-shm` while it's running). |
| `printers/<id>/` | Each printer's own files, such as the simulator's uploaded G-code.            |
| `staging/`       | Uploads on their way to a printer. It's emptied at every start.               |

To see what's been recorded, for example on macOS:

```bash
sqlite3 ~/Library/Application\ Support/open-print-stack/ops.sqlite 'select type, count(*) from events group by 1'
```

#### Checks

Every pull request must pass these, which CI also runs:

```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm --filter @openprintstack/server db:drift
pnpm test
pnpm build
pnpm test:smoke
```

`pnpm test:smoke` starts the build that `pnpm build` made and checks it end to end, so it runs after the build. CI also checks every file's licence information with [REUSE](https://reuse.software/).

Some files are generated, and the checks fail when they're out of date. To regenerate them:

- `apps/server/openapi.json`, the REST API's OpenAPI document: `pnpm --filter @openprintstack/server openapi:emit`
- `apps/server/drizzle/`, the database migrations, after changing `apps/server/src/db/schema.ts`: `pnpm --filter @openprintstack/server db:generate`
- `apps/web/src/api/schema.gen.ts` and `apps/web/src/routeTree.gen.ts`, the web app's API types and routes: `pnpm --filter @openprintstack/web generate`

## Project Structure

A pnpm workspace with two apps and four packages:

```text
apps/
  server/              the server: settings, logging, the database, the event bus and
                       state store, the printer drivers' host, commands and safety checks,
                       the REST API, the WebSocket, and serving the web app
    drizzle/           database migrations, generated from src/db/schema.ts
    openapi.json       the REST API's OpenAPI document, generated from its routes
  web/                 the web app: React, TanStack Router, Query and Form, Tailwind and
                       shadcn/ui
packages/
  protocol/            the Zod schemas and types everything shares: printer state,
                       commands, events and WebSocket messages; it runs in the browser too
  driver-sdk/          the contract every printer driver implements, and the tests every
                       driver must pass
  driver-simulated/    a simulated printer, for trying things out and for tests
  driver-elegoo-cc2/   the Elegoo Centauri Carbon 2 (in progress: status so far), with a
                       fake printer for its tests
docs/
  phase-0.md           the plan for this first phase
  phase-1.md           the plan for the next phase: real printers, discovery and installers
```

Some boundaries are checked by ESLint: the web app talks to printers only through the server's API, `protocol` depends on nothing but Zod, and in the server only `src/drivers/registry.ts` may import a driver.

## Roadmap

- [ ] _Upcoming milestone_

## Contributing

Contributions are welcome! See [CONTRIBUTING.md](CONTRIBUTING.md) to get started. To report a security issue, follow [SECURITY.md](SECURITY.md).

## License

Open Print Stack is licensed under the [GNU Affero General Public License v3.0 or later](LICENSE) (`AGPL-3.0-or-later`).
