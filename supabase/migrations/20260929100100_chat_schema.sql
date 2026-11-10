-- Chat module (C1): conversations, messages, memory, usage and operations tables.
--
-- Same rules as the auth migrations: user_id not null with on delete cascade,
-- RLS enabled in this file, policies on (select auth.uid()), an index on
-- user_id. Message text, titles, summaries, notes and memory moments are
-- encrypted with the user's data key; the app reads them through the RPCs in
-- the next migration. Nothing the server owns is writable by the client.

create extension if not exists vector with schema extensions;

-- Conversations ----------------------------------------------------------------

create table public.conversations (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references auth.users (id) on delete cascade,
  origin           public.conversation_origin not null default 'chat',
  title_enc        bytea,
  guide_draw_id    uuid,          -- foreign key added with the Guides module
  journal_entry_id uuid,          -- foreign key added with the journal module
  exchange_count   int not null default 0,
  started_at       timestamptz not null default now(),
  last_message_at  timestamptz not null default now(),
  cleared_at       timestamptz    -- hidden at once, hard-deleted after 24 h
);
alter table public.conversations enable row level security;
create index conversations_user_recent_idx on public.conversations (user_id, last_message_at desc)
  where cleared_at is null;

create table public.messages (
  id              uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  user_id         uuid not null references auth.users (id) on delete cascade,
  role            public.message_role not null,
  content_enc     bytea,
  status          public.message_status not null default 'complete',
  client_msg_id   uuid,
  input_method    public.input_method,
  mode            public.response_mode,
  reply_to        uuid references public.messages (id) on delete cascade,
  event_kind      text check (event_kind in ('guide_drawn', 'journal_shared', 'paywall', 'crisis_resources')),
  event_ref       uuid,
  -- clock_timestamp, not now(): the order of messages must hold even when
  -- several are written in one transaction.
  created_at      timestamptz not null default clock_timestamp(),
  unique (user_id, client_msg_id),
  check (role <> 'user' or client_msg_id is not null)
);
alter table public.messages enable row level security;
create index messages_conversation_idx on public.messages (conversation_id, created_at);
create index messages_user_idx on public.messages (user_id, created_at desc);
-- One reply per user message, so a retry can never store two answers.
create unique index messages_one_reply_idx on public.messages (reply_to) where role = 'assistant';

-- Technical details of each reply, apart from the text. Rule ids only, never
-- the text that failed a check.
create table public.message_meta (
  message_id       uuid primary key references public.messages (id) on delete cascade,
  user_id          uuid not null references auth.users (id) on delete cascade,
  model            text not null,
  mode             public.response_mode not null,
  planner_how      text check (planner_how in ('deterministic', 'planner', 'enforced', 'crisis', 'fallback')),
  understanding    jsonb not null default '{}',   -- which of the four points it believed it knew
  tokens_in        int,
  tokens_cached    int,
  tokens_out       int,
  cost_eur         numeric(10, 6),
  timings          jsonb not null default '{}',   -- stage -> milliseconds
  hard_failures    text[] not null default '{}',
  retried          boolean not null default false,
  degraded         boolean not null default false,
  crisis_flag      boolean not null default false,
  created_at       timestamptz not null default now(),
  constraint timings_numbers_only check (jsonb_typeof(timings) = 'object'),
  constraint understanding_flags_only check (jsonb_typeof(understanding) = 'object')
);
alter table public.message_meta enable row level security;
create index message_meta_user_idx on public.message_meta (user_id);

-- What was retrieved for each answer (her testing marks, "why did it say that").
-- Kept 90 days.
create table public.message_retrievals (
  message_id  uuid not null references public.messages (id) on delete cascade,
  user_id     uuid not null references auth.users (id) on delete cascade,
  collection  text not null check (collection in ('knowledge', 'video', 'guide', 'guide_map', 'principle',
                                                  'realclient', 'framework', 'exemplar', 'memory')),
  item_id     text not null,
  score       real,
  slot        smallint not null,
  created_at  timestamptz not null default now(),
  primary key (message_id, collection, slot)
);
alter table public.message_retrievals enable row level security;
create index message_retrievals_user_idx on public.message_retrievals (user_id);
create index message_retrievals_created_idx on public.message_retrievals (created_at);

-- The four marks under an answer (Claudia's testing mode).
create table public.answer_marks (
  id          uuid primary key default gen_random_uuid(),
  message_id  uuid not null references public.messages (id) on delete cascade,
  user_id     uuid not null references auth.users (id) on delete cascade,
  mark        public.answer_mark not null,
  note        text check (char_length(note) <= 2000),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (message_id, user_id, mark)
);
alter table public.answer_marks enable row level security;
create index answer_marks_user_idx on public.answer_marks (user_id);

-- Memory, layers 2-4 (layer 1 is profiles + user_context) ---------------------

-- Layer 2: one rolling summary per conversation, always regenerated from that
-- conversation's raw messages, never from an earlier summary.
create table public.conversation_summaries (
  conversation_id      uuid primary key references public.conversations (id) on delete cascade,
  user_id              uuid not null references auth.users (id) on delete cascade,
  summary_enc          bytea not null,
  through_message_id   uuid not null references public.messages (id) on delete cascade,
  source_message_count int not null,
  model                text not null,
  updated_at           timestamptz not null default now()
);
alter table public.conversation_summaries enable row level security;
create index conversation_summaries_user_idx on public.conversation_summaries (user_id, updated_at desc);

-- Layer 3: one row per fact, keyed, so a changed fact updates its row.
create table public.memory_notes (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references auth.users (id) on delete cascade,
  category          public.memory_category not null,
  key               text not null check (key ~ '^[a-z][a-z0-9_.]{0,39}$'),
  content_enc       bytea not null,
  confidence        real not null default 0.7 check (confidence between 0 and 1),
  source_message_id uuid references public.messages (id) on delete set null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (user_id, key)
);
alter table public.memory_notes enable row level security;

-- Layer 4: searchable moments. Kept apart from the knowledge base vectors.
-- Vectors cannot be encrypted and still searched; the text next to them is.
create table public.memory_embeddings (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users (id) on delete cascade,
  source      public.memory_source not null,
  source_id   uuid not null,
  content_enc bytea not null,
  embedding   extensions.vector(1024) not null,
  occurred_at timestamptz not null,
  created_at  timestamptz not null default now()
);
alter table public.memory_embeddings enable row level security;
create index memory_embeddings_user_idx on public.memory_embeddings (user_id, occurred_at desc);
create index memory_embeddings_hnsw on public.memory_embeddings
  using hnsw (embedding extensions.vector_cosine_ops);

-- Membership, trial and usage ---------------------------------------------------

-- Mirror of RevenueCat, written only by the payments webhook (payments module).
create table public.entitlements (
  user_id         uuid primary key references auth.users (id) on delete cascade,
  active          boolean not null default false,
  plan            public.plan_kind,
  product_id      text,
  store           public.store_kind,
  period_ends_at  timestamptz,
  will_renew      boolean,
  last_event_id   text,
  updated_at      timestamptz not null default now()
);
alter table public.entitlements enable row level security;

-- One row per user, locked inside begin_turn.
create table public.usage_state (
  user_id       uuid primary key references auth.users (id) on delete cascade,
  trial_used    int not null default 0,
  day           date not null default (now() at time zone 'Europe/Prague')::date,
  day_count     int not null default 0,
  month         date not null default date_trunc('month', (now() at time zone 'Europe/Prague'))::date,
  month_count   int not null default 0,
  minute_window timestamptz not null default now(),
  minute_count  int not null default 0
);
alter table public.usage_state enable row level security;

create table public.usage_ledger (
  id          bigint generated always as identity primary key,
  user_id     uuid not null references auth.users (id) on delete cascade,
  kind        public.usage_kind not null,
  message_id  uuid references public.messages (id) on delete set null,
  quantity    int not null default 1,
  created_at  timestamptz not null default now()
);
alter table public.usage_ledger enable row level security;
create index usage_ledger_user_idx on public.usage_ledger (user_id, created_at desc);

-- Operations -------------------------------------------------------------------

-- Every AI call, without content. Feeds the cost dashboard.
create table ops.ai_calls (
  id            bigint generated always as identity primary key,
  user_id       uuid references auth.users (id) on delete set null,
  message_id    uuid,
  purpose       text not null check (purpose in ('reply', 'planner', 'retry', 'crisis', 'summary', 'memory',
                                                 'title', 'insight', 'embedding', 'stt', 'tts', 'admin')),
  provider      text not null default 'openai',
  model         text not null,
  tokens_in     int,
  tokens_cached int,
  tokens_out    int,
  cost_eur      numeric(10, 6) not null default 0,
  duration_ms   int,
  ok            boolean not null,
  error_code    text check (error_code ~ '^[A-Za-z0-9_.:-]{1,64}$'),
  created_at    timestamptz not null default now()
);
alter table ops.ai_calls enable row level security;
create index ai_calls_created_idx on ops.ai_calls (created_at);
create index ai_calls_user_idx on ops.ai_calls (user_id, created_at);

-- Post-turn work: titles, summaries, notes, moments. Ids only, never text.
create table ops.jobs_queue (
  id           bigint generated always as identity primary key,
  kind         text not null check (kind in ('title', 'summary', 'notes', 'moments', 'purge')),
  user_id      uuid not null references auth.users (id) on delete cascade,
  payload      jsonb not null default '{}',
  run_after    timestamptz not null default now(),
  attempts     int not null default 0,
  locked_at    timestamptz,
  done_at      timestamptz,
  last_error   text check (last_error ~ '^[A-Za-z0-9_.:-]{1,64}$'),
  created_at   timestamptz not null default now(),
  constraint payload_ids_only check (
    payload - array['conversation_id', 'message_id', 'through_message_id', 'exchange']::text[] = '{}'::jsonb)
);
alter table ops.jobs_queue enable row level security;
create index jobs_queue_ready_idx on ops.jobs_queue (run_after) where done_at is null;
create unique index jobs_queue_dedupe_idx on ops.jobs_queue (kind, user_id, (payload ->> 'conversation_id'))
  where done_at is null;

-- GDPR requests, kept after deletion with user_id nulled, as proof.
create table ops.data_requests (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid references auth.users (id) on delete set null,
  kind         text not null check (kind in ('export', 'delete', 'withdraw_consent', 'clear_memory', 'clear_conversation')),
  status       text not null default 'pending' check (status in ('pending', 'done', 'failed')),
  requested_at timestamptz not null default now(),
  completed_at timestamptz
);
alter table ops.data_requests enable row level security;

-- Access -----------------------------------------------------------------------
-- The client reads display-only rows directly and everything with text through
-- RPCs. It writes only its own answer marks.

revoke all on public.conversations, public.messages, public.message_meta, public.message_retrievals,
              public.answer_marks, public.conversation_summaries, public.memory_notes,
              public.memory_embeddings, public.entitlements, public.usage_state, public.usage_ledger
  from anon, authenticated;
revoke all on all tables in schema ops from public, anon, authenticated;
grant all on all tables in schema ops to service_role;

grant select (id, user_id, origin, exchange_count, started_at, last_message_at)
  on public.conversations to authenticated;
-- Message metadata only (never content_enc), so the answer_marks policy can
-- check ownership and the app can see a message's status.
grant select (id, conversation_id, user_id, role, status, mode, created_at) on public.messages to authenticated;
grant select (user_id, active, plan, period_ends_at, will_renew) on public.entitlements to authenticated;
grant select (user_id, trial_used, day, day_count) on public.usage_state to authenticated;
grant select, insert, delete on public.answer_marks to authenticated;
grant update (note, updated_at) on public.answer_marks to authenticated;

create policy "Users read their own conversations"
  on public.conversations for select to authenticated
  using (user_id = (select auth.uid()) and cleared_at is null);

create policy "Users read their own message metadata"
  on public.messages for select to authenticated
  using (user_id = (select auth.uid()));

create policy "Users read their own entitlement"
  on public.entitlements for select to authenticated
  using (user_id = (select auth.uid()));

create policy "Users read their own usage"
  on public.usage_state for select to authenticated
  using (user_id = (select auth.uid()));

create policy "Users read their own marks"
  on public.answer_marks for select to authenticated
  using (user_id = (select auth.uid()));

create policy "Users mark their own answers"
  on public.answer_marks for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and exists (
      select 1 from public.messages m
      where m.id = message_id and m.user_id = (select auth.uid()) and m.role = 'assistant'
    )
  );

create policy "Users edit their own marks"
  on public.answer_marks for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy "Users remove their own marks"
  on public.answer_marks for delete to authenticated
  using (user_id = (select auth.uid()));

-- Existing accounts get a usage row; new ones get it at sign-up.
insert into public.usage_state (user_id) select id from auth.users on conflict do nothing;

create or replace function private.handle_new_user_usage()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.usage_state (user_id) values (new.id) on conflict do nothing;
  return new;
end $$;
revoke all on function private.handle_new_user_usage() from public, anon, authenticated;

create trigger on_auth_user_created_usage
  after insert on auth.users
  for each row execute function private.handle_new_user_usage();
