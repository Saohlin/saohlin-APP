-- Runtime configuration. Values the app may read are flagged `public`.
create table public.app_config (
  key         text primary key,
  value       jsonb not null,
  description text not null,
  public      boolean not null default false,
  updated_at  timestamptz not null default now()
);
alter table public.app_config enable row level security;

revoke all on public.app_config from anon, authenticated;
grant select on public.app_config to anon, authenticated;

create policy "Public config is readable"
  on public.app_config for select
  to anon, authenticated
  using (public);

insert into public.app_config (key, value, description, public) values
  ('onboarding.min_age',        '15',     'Minimum age to register, in years',                      true),
  ('consent.notice_version',    '"2026-10"', 'Version of the consent notice shown at onboarding',  true),
  ('trial.total_replies',       '5',      'Free AI replies before the paywall',                     true),
  ('app.min_version',           '"1.0"',  'Oldest app version allowed to connect',                  true),
  ('app.maintenance',           'false',  'Maintenance mode',                                       true);

-- Privacy policy, terms, AI disclosure and consent notice, versioned so every
-- consent can point at the exact text that was shown.
create table public.legal_documents (
  id           uuid primary key default gen_random_uuid(),
  kind         text not null check (kind in ('privacy', 'terms', 'ai_disclosure', 'consent_notice')),
  locale       text not null default 'cs',
  version      text not null,
  title        text not null,
  body_md      text not null,
  published_at timestamptz,
  unique (kind, locale, version)
);
alter table public.legal_documents enable row level security;

revoke all on public.legal_documents from anon, authenticated;
grant select on public.legal_documents to anon, authenticated;

create policy "Published documents are readable"
  on public.legal_documents for select
  to anon, authenticated
  using (published_at is not null);
