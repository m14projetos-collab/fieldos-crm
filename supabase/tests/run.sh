#!/usr/bin/env bash
# Valida as migrations num Postgres 15+ descartável (sem Supabase).
# Uso: PGBIN=/usr/lib/postgresql/16/bin ./supabase/tests/run.sh
set -euo pipefail
cd "$(dirname "$0")/../.."
PGBIN="${PGBIN:-/usr/lib/postgresql/16/bin}"
TMP="$(mktemp -d)"
trap '"$PGBIN/pg_ctl" -D "$TMP/data" stop -m fast >/dev/null 2>&1 || true; rm -rf "$TMP"' EXIT
"$PGBIN/initdb" -D "$TMP/data" -U postgres -A trust >/dev/null
"$PGBIN/pg_ctl" -D "$TMP/data" -o "-p 54329 -k $TMP -c listen_addresses=''" -l "$TMP/log" start >/dev/null
PSQL=(psql -h "$TMP" -p 54329 -U postgres -d postgres -v ON_ERROR_STOP=1 -q)
"${PSQL[@]}" -f supabase/tests/00_auth_stub.sql
for f in supabase/migrations/*.sql; do echo "→ $f"; "${PSQL[@]}" -f "$f"; done
"${PSQL[@]}" -f supabase/tests/01_scenarios.sql
