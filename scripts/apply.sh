#!/usr/bin/env bash
# Apply all migrations, then seeds, in order.
#
#   DATABASE_URL="postgresql://user:pass@host:5432/db" ./scripts/apply.sh
#
# Every file is idempotent-safe to the extent Postgres allows; re-running
# a migration that already applied will error on duplicate objects rather
# than silently corrupting state. Run against a branch/backup first.

set -euo pipefail

if [[ -z "${DATABASE_URL:-}" ]]; then
  echo "DATABASE_URL is not set." >&2
  exit 1
fi

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

echo "==> Migrations"
for f in "$ROOT"/migrations/*.sql; do
  echo "    $(basename "$f")"
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -q -f "$f"
done

echo "==> Seeds"
for f in "$ROOT"/seeds/*.sql; do
  echo "    $(basename "$f")"
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -q -f "$f"
done

echo "==> Verify"
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f "$ROOT/scripts/verify.sql"
