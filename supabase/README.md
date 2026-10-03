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
