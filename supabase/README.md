# Backend (Supabase)

## Layout

```
supabase/
  config.toml        local settings (auth rules, redirect URLs, email templates)
  migrations/        schema changes, applied in order
  templates/         Czech auth emails
  tests/database/    pgTAP tests: security rules and onboarding
```

## First-time setup

```bash
brew install supabase/tap/supabase
supabase login
supabase link --project-ref YOUR_PROJECT_REF
supabase db push                 # applies migrations/
supabase config push             # auth settings and email templates
```

Then copy `.env.example` to `.env.local` and fill in the project URL and publishable key.

In the dashboard, also check:

- Authentication → URL Configuration: redirect URLs include `saohlin://auth-callback`
  and `saohlin://reset-password` (plus `exp://**` for Expo Go during development).
- Authentication → Emails: custom SMTP (the built-in sender is rate-limited and not for production).
- Authentication → Attack Protection: leaked password protection and CAPTCHA.

## Knowledge base

Claudia's material lives in the `kb` schema (service role only). It is loaded
from the corpus the Python pipeline already built and embedded, so loading
costs no OpenAI credit:

```bash
pip install "psycopg[binary]" numpy
export DATABASE_URL=postgresql://postgres:...@db.PROJECT.supabase.co:5432/postgres
python supabase/seed/load_kb.py --base "/path/to/AI APP"
python supabase/seed/check_retrieval_parity.py --base "/path/to/AI APP"
```

The parity check runs the 78-case Czech test set through the Python pipeline
and the database side by side and fails on any difference. The corpus is her
intellectual property and stays out of this repository.

## Chat function

`functions/chat` runs one turn: gate and save (`start_turn`), crisis screen,
planner, embedding and retrieval in parallel, the prompt, the reply streamed
sentence by sentence through her checks, then `finish_turn`. The contract is
in `functions/_shared/chat/contract.ts`; the pipeline in `_shared/pipeline/`.

```bash
supabase secrets set OPENAI_API_KEY=sk-...            # dev key, hard monthly cap
supabase secrets set SAOHLIN_ENV=development          # production refuses to chat while
                                                      # crisis.resources is empty
supabase functions deploy chat
```

Model names, temperatures, prices, limits and her limit messages are rows in
`app_config`, not code. Tests:

```bash
deno test -A supabase/functions/_shared/pipeline/                      # unit + parity
PGHOST=/tmp DATABASE_URL=postgres://postgres@localhost:54322/saohlin_test \
  deno test -A supabase/functions/_shared/chat/                        # the turn against the real schema
```

## Memory jobs

After a reply is stored, the database queues work in `ops.jobs_queue`: a title
after exchange 2, a summary and notes every `memory.summary_every` exchanges, and
a final summary, notes and moments once a conversation has been quiet for
`memory.idle_minutes`. The `jobs` function does the work. It is never in the path
of a reply.

Every minute `ops.memory_tick()` (pg_cron) queues idle conversations and, if
anything is ready, calls the function through pg_net. Any number of workers can
run at once: jobs are leased with `SKIP LOCKED`, retried with backoff, and given
up on after `memory.job_max_attempts`.

One-time setup per project:

```sh
# 1. A long random secret, set on the function...
supabase secrets set JOBS_SECRET="$(openssl rand -hex 32)"
supabase functions deploy jobs --no-verify-jwt
```

```sql
-- 2. ...and the same value, plus the function URL, in Vault (SQL editor).
select vault.create_secret('https://<project-ref>.supabase.co/functions/v1/jobs', 'jobs_function_url');
select vault.create_secret('<the JOBS_SECRET value>', 'jobs_secret');
```

Until both Vault entries exist nothing is called and jobs wait in the queue.

Settings (rows in `app_config`, no deploy needed): `memory.summary_every`,
`memory.idle_minutes`, `memory.notes_max`, `memory.recent_conversations`,
`memory.job_max_messages`, `memory.job_max_attempts`, `memory.max_workers`,
`memory.moments_min_exchanges`, `memory.moments_per_conversation`, and
`memory.profile_stale_days` (the onboarding answers are gently re-checked once
after this many days; 0 turns it off).

`supabase/functions/_shared/memory/stress_test.ts` runs chatting users, three
workers, the sweep, and users forgetting, clearing and withdrawing consent all
at once on real connections. Run it after any change to the queue functions:
`STRESS_MS=20000 DATABASE_URL=... deno test -A supabase/functions/_shared/memory/stress_test.ts`.
To look at the queue: `select kind, attempts, last_error, done_at from ops.jobs_queue order by id desc limit 20;`

## Journal

The journal (Deník) is one table, `public.journal_entries`, and no Edge Function of its
own. Text is stored only as ciphertext under the user's data key, and no role has a
grant on the table, the service role included: the app uses the `journal_*` functions.

- **Private by default.** `journal_home`, `journal_list`, `journal_days`, `journal_get`,
  `journal_save`, `journal_save_message`, `journal_delete`, `journal_restore` and
  `journal_search` never involve the AI. Call them with POST (the `supabase.rpc`
  default); with `{ get: true }` the arguments would travel in the URL.
- **Sharing is explicit.** `journal_share` flips the flag and opens a conversation with
  `origin = 'journal_share'`. The reflection is an ordinary chat turn: the chat function
  gets the entry from `turn_context`, never from the app. `journal_unshare` takes it back.
- **Memory.** No user action queues a job. Every minute `ops.memory_tick()` also queues a
  `journal` job for each shared entry that is not indexed at its current version; the
  `jobs` worker turns it into at most `journal.moments_per_entry` short reflections.
- **Limits and conflicts are return values** (`{ "kind": "limit" | "conflict" }`), not errors.

A private entry cannot reach the model: only `turn_context` and `journal_job_context`
decrypt an entry for it, and both require `shared_with_ai`; a trigger removes an entry's
memory rows in the transaction that un-shares, edits or deletes it; `journal_job_save`
re-checks the flag and the version under the row lock; and `memory_search` ignores a
journal row whose entry is not shared right now.

Settings (rows in `app_config`): `journal.body_max_chars`, `journal.title_max_chars`,
`journal.writes_per_minute`, `journal.searches_per_minute`, `journal.entries_per_day`,
`journal.entries_max`, `journal.search_scan_max`, `journal.shares_per_day`,
`journal.share_max_chars`, `journal.share_inject_exchanges`, `journal.moments_per_entry`,
`journal.reindex_delay_seconds`.

After deploying the journal migrations, redeploy both functions (`chat` reads the shared
entry, `jobs` knows the new job kind) and check once per project:

```sql
-- must be false: nothing but the functions reads the table
select has_table_privilege('service_role', 'public.journal_entries', 'select');
-- statement logging must not capture function arguments (entry text is one of them)
show log_statement; show log_min_duration_statement; show log_parameter_max_length_on_error;
-- after sharing an entry and waiting a minute: done_at set, last_error null
select kind, attempts, last_error, done_at from ops.jobs_queue where kind = 'journal' order by id desc limit 5;
```

`supabase/functions/_shared/memory/journal_test.ts` is the G4.3 proof (share five entries,
keep five private, inspect every model call and the index) and a contention run of share,
edit, un-share, delete, forget and three workers. Run it after any change to the journal
or the queue: `STRESS_MS=20000 DATABASE_URL=... deno test -A supabase/functions/_shared/memory/journal_test.ts`.

## Tests

```bash
supabase test db
```

Run before every deploy.

Without Docker, `tests/local/run_local_tests.sh` applies the migrations to a plain
Postgres 16 with pgvector and pgTAP (using a small stand-in for Supabase's `auth`
and `vault` schemas) and runs the same tests. The security tests fail if a table is added without RLS,
if a `user_id` column is nullable or doesn't cascade, or if a function becomes
callable by roles that shouldn't have it.

## Rules for new migrations

- New user tables: `user_id not null references auth.users on delete cascade`,
  and `enable row level security` in the same file.
- Policies use `(select auth.uid())`, not `auth.uid()`.
- Functions the app calls are granted to `authenticated` explicitly; everything
  else stays private.
- Sensitive text is stored with `private.encrypt(user_id, value)` and read back
  through a security definer function.
