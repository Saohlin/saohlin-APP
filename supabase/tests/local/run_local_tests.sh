#!/usr/bin/env bash
# Applies every migration to a fresh database on a plain Postgres 16 (with
# pgvector and pgTAP installed) and runs the pgTAP tests. Useful where the
# Supabase CLI and Docker aren't available. `supabase test db` remains the
# reference run.
#
#   PGHOST=/tmp PGPORT=54322 PGUSER=postgres supabase/tests/local/run_local_tests.sh
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
root="$(cd "$here/../.." && pwd)"
db="${TEST_DB:-saohlin_test}"

dropdb --if-exists "$db" >/dev/null
createdb "$db"
psql -q -v ON_ERROR_STOP=1 -d "$db" -f "$here/supabase_stub.sql" >/dev/null
for f in "$root"/migrations/*.sql; do
  psql -q -v ON_ERROR_STOP=1 -d "$db" -f "$f" >/dev/null || { echo "FAILED: $f"; exit 1; }
done
psql -q -d "$db" -c 'create extension if not exists pgtap with schema extensions' >/dev/null

fail=0
for t in "$root"/tests/database/*.test.sql; do
  out="$(PGOPTIONS='-c search_path=public,extensions' psql -X -q -At -v ON_ERROR_STOP=1 -d "$db" -f "$t" 2>&1)" || fail=1
  if grep -qE '^not ok|ERROR|Looks like' <<<"$out"; then fail=1; echo "✗ $(basename "$t")"; echo "$out" | grep -E '^not ok|#|ERROR' | head -40
  else echo "✓ $(basename "$t") ($(grep -c '^ok' <<<"$out") assertions)"; fi
done
exit $fail
