#!/usr/bin/env bash
# Teste la migration et les règles d'accès sur un PostgreSQL local jetable (PostgreSQL 15 ou plus, avec citext).
# Usage : scripts/test-db.sh   (BIN=/usr/lib/postgresql/16/bin par défaut)
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BIN="${BIN:-/usr/lib/postgresql/16/bin}"
DIR="$(mktemp -d)"; PORT="${PORT:-54329}"
RUN=(); [ "$(id -u)" = 0 ] && { chown -R postgres "$DIR"; RUN=(runuser -u postgres --); }
"${RUN[@]}" "$BIN/initdb" -D "$DIR/data" -A trust -U postgres >/dev/null
"${RUN[@]}" "$BIN/pg_ctl" -D "$DIR/data" -o "-p $PORT -k $DIR" -l "$DIR/log" -w start >/dev/null
trap '"${RUN[@]}" "$BIN/pg_ctl" -D "$DIR/data" -m immediate stop >/dev/null; rm -rf "$DIR"' EXIT
P=(psql -h "$DIR" -p "$PORT" -U postgres -d postgres -v ON_ERROR_STOP=1 -q)
"${P[@]}" -f "$ROOT/supabase/tests/supabase_stub.sql"
"${P[@]}" -f "$ROOT/supabase/migrations/20261126000000_players.sql"
"${P[@]}" -f "$ROOT/supabase/seed.sql"
"${P[@]}" -f "$ROOT/supabase/tests/players_test.sql" 2>&1 | sed 's/^psql:[^ ]* NOTICE:  /  /'
