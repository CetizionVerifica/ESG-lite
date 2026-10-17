#!/usr/bin/env bash
# Runs the end-to-end data workflow test on this machine (ci/workflow/README.md).
# Needs a local Postgres. Override any DB_* variable to point elsewhere; the
# database name must start with ci_ and is emptied on every run.
set -euo pipefail
cd "$(dirname "$0")/../.."

export CI_THROWAWAY_DB=true
export DB_HOST="${DB_HOST:-localhost}" DB_PORT="${DB_PORT:-5432}"
export DB_USERNAME="${DB_USERNAME:-postgres}" DB_PASSWORD="${DB_PASSWORD:-postgres}"
export DB_NAME="${DB_NAME:-ci_workflow}" TZ=UTC
unset DATABASE_URL

if command -v psql >/dev/null 2>&1; then
  if ! PGPASSWORD="$DB_PASSWORD" psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USERNAME" -d postgres -Atc "SELECT 1 FROM pg_database WHERE datname = '$DB_NAME'" | grep -q 1; then
    echo "Creating database $DB_NAME"
    PGPASSWORD="$DB_PASSWORD" createdb -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USERNAME" "$DB_NAME"
  fi
fi

[ -d node_modules ] || npm ci
npm run build
npm run test:workflow
