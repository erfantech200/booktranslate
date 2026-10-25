#!/usr/bin/env bash
# Throwaway Postgres 16 → Supabase stub → migrations → DB-backed tests (queue, RLS, golden pipeline).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PGBIN="${PGBIN:-$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -1)}"
PORT="${PGPORT_TEST:-54329}"
DIR="$(mktemp -d /tmp/bb-pg-XXXX)"
RUN_AS=()
if [ "$(id -u)" = "0" ]; then chown postgres "$DIR"; RUN_AS=(runuser -u postgres --); fi
"${RUN_AS[@]}" "$PGBIN/initdb" -D "$DIR/data" -U postgres -A trust >/dev/null
"${RUN_AS[@]}" "$PGBIN/pg_ctl" -D "$DIR/data" -o "-p $PORT -k $DIR -c listen_addresses=localhost" -l "$DIR/log" -w start >/dev/null
cleanup() { "${RUN_AS[@]}" "$PGBIN/pg_ctl" -D "$DIR/data" -m fast stop >/dev/null || true; rm -rf "$DIR"; }
trap cleanup EXIT
export DATABASE_URL="postgres://postgres@localhost:$PORT/postgres"
psql -q -v ON_ERROR_STOP=1 "$DATABASE_URL" -f "$ROOT/supabase/test/supabase-stub.sql" >/dev/null
for f in "$ROOT"/supabase/migrations/*.sql; do psql -q -v ON_ERROR_STOP=1 "$DATABASE_URL" -f "$f" >/dev/null; done
echo "migrations applied on $DATABASE_URL"
cd "$ROOT/packages/core"
DB_TESTS=1 npx vitest run test/db "$@"
