#!/usr/bin/env bash
# Teste les migrations et les règles d'accès sur un PostgreSQL local jetable (PostgreSQL 15 ou plus, avec citext),
# puis la fonction de correction (supabase/functions/quiz/core.js) avec Node 22 contre cette base.
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
notices() { sed 's/^psql:[^ ]* NOTICE:  /  /'; }
"${P[@]}" -f "$ROOT/supabase/tests/supabase_stub.sql"
for f in "$ROOT"/supabase/migrations/*.sql; do "${P[@]}" -f "$f"; done
"${P[@]}" -f "$ROOT/supabase/seed.sql"
"${P[@]}" -f "$ROOT/supabase/seed_cards.sql"
# Questions de test (fictives) : passent par le même générateur que les vraies.
node "$ROOT/scripts/gen-questions-sql.mjs" "$ROOT/supabase/tests/fixtures/questions.json" \
  "$ROOT/supabase/tests/fixtures/synonyms.json" "$DIR/questions.sql" 2>/dev/null
"${P[@]}" -f "$DIR/questions.sql"
echo "Joueurs, amis, ligues :"
"${P[@]}" -f "$ROOT/supabase/tests/players_test.sql" 2>&1 | notices
echo "Partie du jour (base) :"
"${P[@]}" -f "$ROOT/supabase/tests/quiz_test.sql" 2>&1 | notices
echo "Partie du jour (fonction de correction) :"
PGHOST="$DIR" PGPORT="$PORT" PGUSER=postgres PGDATABASE=postgres node "$ROOT/supabase/tests/quiz_flow.test.mjs"
echo "Fonction Edge (enveloppe HTTP) :"
PGHOST="$DIR" PGPORT="$PORT" PGUSER=postgres PGDATABASE=postgres node "$ROOT/supabase/tests/quiz_http.test.mjs"
