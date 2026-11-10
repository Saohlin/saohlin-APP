-- Journal module (J1): the table, its indexes and cleanup triggers, and the
-- small changes to existing objects the journal needs.
--
-- Same rules as the chat schema: user_id not null with on delete cascade, RLS
-- enabled here, text stored only as ciphertext under the user's data key.
-- Nothing in this table is readable or writable by any API role; the app uses
-- the functions in the next migration.
--
-- An entry is private by default. Only an entry the user chose to share can
-- reach the AI, and everything derived from it (rows in memory_embeddings) is
-- removed in the same transaction that un-shares, edits or deletes it.

create type public.journal_source as enum ('manual', 'saved_message', 'guide');

create table public.journal_entries (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references auth.users (id) on delete cascade,
  client_entry_id   uuid not null,      -- made on the phone; a retried save reuses it
  entry_date        date not null,      -- the day the entry belongs to (Europe/Prague)
  title_enc         bytea,
  excerpt_enc       bytea not null,     -- first 160 characters, for lists
  body_enc          bytea not null,
  -- The ceiling. journal.body_max_chars can lower the limit, never raise it.
  body_chars        int not null check (body_chars between 1 and 10000),
  source            public.journal_source not null default 'manual',
  source_message_id uuid references public.messages (id) on delete set null,
  guide_id          smallint,           -- foreign key added with the Guides module
  shared_with_ai    boolean not null default false,
  shared_at         timestamptz,
  indexed_version   int,                -- the version the memory job last indexed
  version           int not null default 1,
  created_at        timestamptz not null default clock_timestamp(),
  updated_at        timestamptz not null default clock_timestamp(),
  deleted_at        timestamptz,        -- hidden at once, hard-deleted after 24 h
  unique (user_id, client_entry_id),
  constraint journal_shared_has_time check (shared_with_ai = (shared_at is not null)),
  constraint journal_deleted_not_shared check (not (shared_with_ai and deleted_at is not null))
);
alter table public.journal_entries enable row level security;
-- No policy and no grant, the service role included: functions only.
revoke all on public.journal_entries from public, anon, authenticated, service_role;

-- Lists, the archive and the week strip: newest first, keyset paging.
create index journal_entries_list_idx on public.journal_entries
  (user_id, entry_date desc, created_at desc, id desc) where deleted_at is null;

-- "Is this message already saved?": saving the same message twice gives one entry.
create unique index journal_entries_saved_msg_idx on public.journal_entries
  (user_id, source_message_id) where source_message_id is not null and deleted_at is null;

-- Purging a conversation deletes its messages; each one looks here to clear
-- source_message_id. Without this index that is a scan per message.
create index journal_entries_source_msg_idx on public.journal_entries (source_message_id)
  where source_message_id is not null;

-- Shared entries of one user (memory screen, "forget everything").
create index journal_entries_shared_idx on public.journal_entries
  (user_id, shared_at desc) where shared_with_ai and deleted_at is null;

-- The minute sweep: shared entries whose memory rows are missing or out of date.
create index journal_entries_unindexed_idx on public.journal_entries (updated_at)
  where shared_with_ai and deleted_at is null and indexed_version is distinct from version;

-- The nightly purge of entries deleted more than 24 hours ago.
create index journal_entries_purge_idx on public.journal_entries (deleted_at) where deleted_at is not null;

-- Daily count for the rate limit. Deleted rows count on purpose, so deleting
-- entries does not buy more writes.
create index journal_entries_recent_idx on public.journal_entries (user_id, created_at desc);

-- Cleanup --------------------------------------------------------------------------

-- Memory rows made from an entry go in the same transaction as the change
-- that makes them invalid. Compares version, not body_enc: ciphertext differs
-- on every encryption of the same text.
create or replace function private.journal_drop_memory()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.memory_embeddings
  where source = 'journal_entry' and source_id = old.id and user_id = old.user_id;
  if tg_op = 'UPDATE' then
    new.indexed_version := null;
    return new;
  end if;
  return old;
end $$;
revoke all on function private.journal_drop_memory() from public, anon, authenticated;

-- Un-share, soft delete (which also un-shares) and any edit of a shared entry.
-- An edit of a private entry does not run the function at all.
create trigger journal_entries_drop_memory_upd
  before update on public.journal_entries
  for each row when (old.shared_with_ai and (not new.shared_with_ai or new.version <> old.version))
  execute function private.journal_drop_memory();

-- Hard delete (the purge). Account deletion removes both tables by cascade.
create trigger journal_entries_drop_memory_del
  after delete on public.journal_entries
  for each row execute function private.journal_drop_memory();

-- Existing objects -----------------------------------------------------------------

-- The column has been on conversations since the chat schema.
alter table public.conversations
  add constraint conversations_journal_entry_fk
  foreign key (journal_entry_id) references public.journal_entries (id) on delete set null;
create index conversations_journal_entry_idx on public.conversations (journal_entry_id)
  where journal_entry_id is not null;

-- A fifth job kind. Payloads stay ids only.
alter table ops.jobs_queue drop constraint jobs_queue_kind_check;
alter table ops.jobs_queue add constraint jobs_queue_kind_check
  check (kind in ('title', 'summary', 'notes', 'moments', 'purge', 'journal'));
alter table ops.jobs_queue drop constraint payload_ids_only;
alter table ops.jobs_queue add constraint payload_ids_only check (
  payload - array['conversation_id', 'message_id', 'through_message_id', 'exchange', 'entry_id']::text[] = '{}'::jsonb);
-- One open job per entry. The existing dedupe index keys on conversation_id,
-- which is null for journal jobs.
create unique index jobs_queue_journal_idx on ops.jobs_queue (user_id, (payload ->> 'entry_id'))
  where kind = 'journal' and done_at is null;

-- Per-minute counters for journal writes and searches, next to the chat ones.
alter table public.usage_state
  add column journal_minute_window timestamptz not null default now(),
  add column journal_minute_count  int not null default 0,
  add column journal_search_window timestamptz not null default now(),
  add column journal_search_count  int not null default 0;

insert into public.app_config (key, value, description, public) values
  ('journal.body_max_chars',         '10000', 'Longest journal entry, in characters (the table ceiling is 10,000)',          true),
  ('journal.title_max_chars',        '120',   'Longest journal entry title',                                                  true),
  ('journal.writes_per_minute',      '20',    'Journal saves, deletes, restores and shares per minute per user',              false),
  ('journal.searches_per_minute',    '30',    'Journal searches per minute per user',                                         false),
  ('journal.entries_per_day',        '100',   'New journal entries per user per day (Prague)',                                false),
  ('journal.entries_max',            '5000',  'Most journal entries one user can keep',                                       false),
  ('journal.search_scan_max',        '1000',  'Newest entries a journal search reads',                                        true),
  ('journal.shares_per_day',         '20',    'Entries a user can share with CLAUDIA AI per day (Prague)',                    false),
  ('journal.share_max_chars',        '4000',  'Characters of a shared entry that reach the AI',                               true),
  ('journal.share_inject_exchanges', '10',    'Exchanges during which the shared entry stays in the prompt',                  false),
  ('journal.moments_per_entry',      '2',     'Most memory reflections kept per shared entry',                                false),
  ('journal.reindex_delay_seconds',  '120',   'Quiet time after an edit before a shared entry is indexed again',              false)
on conflict (key) do nothing;
