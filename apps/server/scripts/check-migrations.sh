#!/usr/bin/env bash
# SPDX-FileCopyrightText: 2026 Open Print Stack contributors
# SPDX-License-Identifier: AGPL-3.0-or-later

# Fails if the committed migrations in drizzle/ don't match src/db/schema.ts,
# or if two migrations clash (e.g. after merging two branches that each added
# one). CI runs it; locally, run `pnpm --filter @openprintstack/server
# db:drift`. drizzle/ is put back exactly as it was afterwards.
set -euo pipefail
cd "$(dirname "$0")/.."

drizzle-kit check

backup=$(mktemp -d)
cp -R drizzle "$backup/"
restore() {
  rm -rf drizzle
  cp -R "$backup/drizzle" drizzle
  rm -rf "$backup"
}
trap restore EXIT

# drizzle-kit exits 0 even when it gives up, e.g. when it would have to ask
# whether a column was renamed and there's no terminal to ask in. So also
# require its "nothing to do" message.
status=0
output=$(drizzle-kit generate --name drift_check </dev/null 2>&1) || status=$?
printf '%s\n' "$output"

if [[ $status -ne 0 ]] ||
  [[ $output != *"No schema changes, nothing to migrate"* ]] ||
  ! diff -r "$backup/drizzle" drizzle >/dev/null; then
  echo "::error::apps/server/drizzle/ doesn't match src/db/schema.ts. Run 'pnpm --filter @openprintstack/server db:generate --name <what_changed>' and commit the result."
  exit 1
fi
echo "The migrations match the schema."
