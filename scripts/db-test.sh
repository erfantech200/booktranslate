#!/usr/bin/env bash
# Throwaway Postgres 16 → Supabase stub → migrations through the real runner → DB-backed tests.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PGBIN="${PGBIN:-$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -1)}"
PORT="${PGPORT_TEST:-54329}"
DIR="$(mktemp -d /tmp/coach-pg-XXXX)"
RUN_AS=()
if [ "$(id -u)" = "0" ]; then chown postgres "$DIR"; RUN_AS=(runuser -u postgres --); fi
"${RUN_AS[@]}" "$PGBIN/initdb" -D "$DIR/data" -U postgres -A trust >/dev/null
"${RUN_AS[@]}" "$PGBIN/pg_ctl" -D "$DIR/data" -o "-p $PORT -k $DIR -c listen_addresses=localhost" -l "$DIR/log" -w start >/dev/null
cleanup() { "${RUN_AS[@]}" "$PGBIN/pg_ctl" -D "$DIR/data" -m fast stop >/dev/null || true; rm -rf "$DIR"; }
trap cleanup EXIT
export DATABASE_URL="postgres://postgres@localhost:$PORT/postgres"
psql -q -v ON_ERROR_STOP=1 "$DATABASE_URL" -f "$ROOT/supabase/test/supabase-stub.sql" >/dev/null
cd "$ROOT/packages/core"
# Every destructive migration is confirmed here: this database is thrown away.
CONFIRM=$(grep -l '^-- @destructive' "$ROOT"/supabase/migrations/*.sql | xargs -n1 basename | tr '\n' ',' )
for c in ${CONFIRM//,/ }; do npx tsx scripts/migrate.ts --apply --confirm="$c" >/dev/null || true; done
npx tsx scripts/migrate.ts --apply
DB_TESTS=1 npx vitest run test/db "$@"
