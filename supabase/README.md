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
