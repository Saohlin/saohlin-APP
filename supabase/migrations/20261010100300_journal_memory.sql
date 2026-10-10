-- Journal module (J4): memory. A shared entry becomes a few short reflections
-- in layer 4, and everything that must keep a private entry away from the AI.
--
-- Worker (service_role): journal_job_context, journal_job_save,
--   enqueue_journal_memory.
-- Changed: memory_search (a filter for journal rows), clear_memory (un-shares
--   every entry), purge_expired (hard-deletes entries after 24 h), get_memory
--   (sharedEntriesCount), ops.memory_tick (the journal sweep).
-- Not changed: job_context and save_job_result. They look up a conversation
--   for every job, so the worker sends a 'journal' job to the two functions
--   here instead (worker.ts branches on the kind first).
--
-- How an entry gets indexed: no user action inserts a job. Sharing or editing
-- leaves the entry with indexed_version distinct from version; the minute
-- sweep queues it. That keeps user paths away from the queue, so the lock
-- order stays: memory lock, job row, entry row for the worker; usage row,
-- entry row for the user; and nobody holds an entry row while waiting on a job.
--
-- A private entry cannot reach the model because:
--   1. only turn_context and journal_job_context decrypt an entry for it, and
--      both require shared_with_ai and deleted_at is null in their where clause;
--   2. the cleanup trigger removes an entry's memory rows in the transaction
--      that un-shares, edits or deletes it;
--   3. journal_job_save re-checks the flag and the version under the row lock,
--      so a job that started earlier writes nothing;
--   4. memory_search ignores a journal row whose entry is not shared right now.

-- Worker functions (service_role only) ---------------------------------------------

-- What one journal job needs to read. Returns {"skip": reason} and closes the
-- job when there is nothing to do.
create or replace function public.journal_job_context(p_job bigint, p_lease uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  job ops.jobs_queue%rowtype;
  e   public.journal_entries%rowtype;
  dek text;
  cut int := private.config_int('journal.share_max_chars', 4000);
begin
  select * into job from ops.jobs_queue
  where id = p_job and done_at is null and lease = p_lease and kind = 'journal';
  if not found then
    return jsonb_build_object('skip', 'stale');
  end if;

  if not private.ai_allowed(job.user_id) then
    perform private.finish_job(p_job, 'consent');
    return jsonb_build_object('skip', 'consent');
  end if;

  select * into e from public.journal_entries
  where id = (job.payload ->> 'entry_id')::uuid and user_id = job.user_id
    and shared_with_ai and deleted_at is null;
  if not found then
    perform private.finish_job(p_job, 'gone');
    return jsonb_build_object('skip', 'gone');
  end if;
  if e.indexed_version is not distinct from e.version then
    perform private.finish_job(p_job, 'current');
    return jsonb_build_object('skip', 'current');
  end if;

  dek := private.user_dek(job.user_id);
  return jsonb_build_object(
    'kind', 'journal', 'userId', job.user_id, 'entryId', e.id, 'version', e.version,
    'date', e.entry_date,
    'title', private.decrypt_with(dek, e.title_enc),
    'text', left(private.decrypt_with(dek, e.body_enc), cut),
    'gender', (select p.gender from public.profiles p where p.user_id = job.user_id));
end $$;

-- Store a journal job's result: p_result = { version, moments: [{ content,
-- embedding }] }. One transaction, same shape as save_job_result. Nothing is
-- written if the entry was un-shared, deleted or edited while the job ran, or
-- if consent was withdrawn. An empty list is a valid result: an entry with no
-- insight in it leaves no memory.
create or replace function public.journal_job_save(p_job bigint, p_lease uuid, p_result jsonb,
                                                   p_calls jsonb default '[]')
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  job   ops.jobs_queue%rowtype;
  e     public.journal_entries%rowtype;
  dek   text;
  owner uuid;
begin
  select user_id into owner from ops.jobs_queue where id = p_job;
  if not found then
    return 'stale';
  end if;
  -- Lock order everywhere: the user's memory lock, the job row, the entry.
  perform private.memory_lock(owner);
  select * into job from ops.jobs_queue where id = p_job for update;
  -- The model calls were made and paid for whatever happens next.
  perform public.log_ai_calls(job.user_id, null, p_calls);
  if job.done_at is not null or job.lease is distinct from p_lease or job.kind <> 'journal' then
    return 'stale';
  end if;

  if not private.ai_allowed(job.user_id) then
    perform private.finish_job(p_job, 'consent');
    return 'stale';
  end if;

  select * into e from public.journal_entries
  where id = (job.payload ->> 'entry_id')::uuid and user_id = job.user_id
    and shared_with_ai and deleted_at is null
  for update;
  if not found then
    perform private.finish_job(p_job, 'gone');
    return 'stale';
  end if;
  -- Edited while the job was reading: what it read is no longer the entry.
  -- The sweep queues the new version.
  if e.version is distinct from (p_result ->> 'version')::int then
    perform private.finish_job(p_job, 'changed');
    return 'stale';
  end if;

  dek := private.user_dek(job.user_id);

  -- An entry's reflections are replaced as a set, never appended to.
  delete from public.memory_embeddings m
  where m.user_id = job.user_id and m.source = 'journal_entry' and m.source_id = e.id;

  insert into public.memory_embeddings (user_id, source, source_id, content_enc, embedding, occurred_at)
  select job.user_id, 'journal_entry', e.id,
         private.encrypt_with(dek, left(btrim(m ->> 'content'), 1200)),
         (m ->> 'embedding')::extensions.vector(1024),
         (e.entry_date + time '12:00') at time zone 'Europe/Prague'
  from jsonb_array_elements(coalesce(p_result -> 'moments', '[]')) with ordinality as x(m, o)
  where nullif(btrim(m ->> 'content'), '') is not null and (m -> 'embedding') is not null
    and o <= private.config_int('journal.moments_per_entry', 2);

  -- Not an edit: version and the shared flag stay, so the cleanup trigger
  -- does not fire.
  update public.journal_entries set indexed_version = version where id = e.id;

  perform private.finish_job(p_job, null);
  return 'saved';
end $$;

-- The sweep: queue a job for every shared entry that is not indexed at its
-- current version. Waits journal.reindex_delay_seconds after an edit, so ten
-- quick edits make one job. An entry whose last job failed, gave up or
-- expired is tried again after six hours, not every minute. A job closed by
-- a consent withdrawal does not count as a try. Returns the number queued.
create or replace function public.enqueue_journal_memory(p_limit int default 200)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  n     int;
  quiet interval := make_interval(secs => private.config_int('journal.reindex_delay_seconds', 120));
begin
  with due as (
    select e.id, e.user_id
    from public.journal_entries e
    where e.shared_with_ai and e.deleted_at is null and e.indexed_version is distinct from e.version
      and e.updated_at < clock_timestamp() - quiet
      and private.ai_allowed(e.user_id)
      and not exists (
        select 1 from ops.jobs_queue q
        where q.user_id = e.user_id and q.kind = 'journal' and q.payload ->> 'entry_id' = e.id::text
          and (q.done_at is null
               or (q.created_at > greatest(e.updated_at, e.shared_at)
                   and q.created_at > clock_timestamp() - interval '6 hours'
                   and q.last_error is distinct from 'consent')))
    order by e.updated_at
    limit least(greatest(coalesce(p_limit, 200), 1), 1000)
  ),
  queued as (
    -- clock_timestamp(): "created after the entry last changed" must hold even
    -- when both happen inside one transaction.
    insert into ops.jobs_queue (kind, user_id, payload, created_at)
    select 'journal', d.user_id, jsonb_build_object('entry_id', d.id), clock_timestamp() from due d
    on conflict do nothing
    returning 1
  )
  select count(*)::int into n from queued;
  return n;
end $$;

create or replace function ops.memory_tick()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Up to 500 idle conversations a minute, in batches of 100.
  for i in 1..5 loop
    exit when public.enqueue_idle_memory(100) < 100;
  end loop;
  -- Shared journal entries waiting to be indexed. Its own block: a problem
  -- here must not undo the sweep above or stop the worker being woken.
  begin
    perform public.enqueue_journal_memory(200);
  exception when others then
    raise warning 'memory_tick: journal sweep failed (%)', sqlstate;
  end;
  -- A problem waking the worker must not undo the sweeps above.
  begin
    perform ops.kick_jobs();
  exception when others then
    raise warning 'memory_tick: kick failed (%)', sqlstate;
  end;
end $$;
revoke all on function ops.memory_tick() from public, anon, authenticated;

-- Changed read and housekeeping functions ------------------------------------------

-- Layer 4 search, with one more condition: a journal row is a candidate only
-- while its entry exists for this user, is shared and is not deleted. Even a
-- vector that should not be there cannot be retrieved.
create or replace function public.memory_search(
  p_user uuid, p_embedding extensions.vector, p_limit int default 3, p_min_similarity real default 0.35)
returns table (id uuid, source public.memory_source, content text, occurred_at timestamptz, similarity real)
language sql
stable
security definer
set search_path = ''
as $$
  with mine as materialized (
    select m.id, m.source, m.content_enc, m.occurred_at,
           (1 - extensions.cosine_distance(m.embedding, p_embedding))::real as similarity
    from public.memory_embeddings m
    where m.user_id = p_user
      and not (m.source = 'conversation_insight' and exists (
        select 1 from public.conversations c where c.id = m.source_id and c.cleared_at is not null))
      and not (m.source = 'journal_entry' and not exists (
        select 1 from public.journal_entries j
        where j.id = m.source_id and j.user_id = p_user and j.shared_with_ai and j.deleted_at is null))
  ),
  k as (select private.user_dek(p_user) as dek)
  select mine.id, mine.source, private.decrypt_with(k.dek, mine.content_enc), mine.occurred_at, mine.similarity
  from mine, k
  where mine.similarity >= p_min_similarity
  order by mine.similarity desc
  limit least(greatest(p_limit, 0), 10)
$$;

-- "Zapomenout všechno" also takes every entry back from the AI. The entries
-- themselves stay: they are the user's writing, not CLAUDIA AI's memory.
-- Entries are un-shared BEFORE the blanket delete of memory rows, so every
-- path locks an entry row before that entry's memory rows.
create or replace function public.clear_memory()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare uid uuid := private.require_uid();
begin
  perform private.memory_lock(uid);
  insert into public.memory_state (user_id, forgot_at) values (uid, clock_timestamp())
  on conflict (user_id) do update set forgot_at = clock_timestamp();
  -- Conversations before the queue, the same order the reply path uses.
  update public.conversations set cleared_at = now() where user_id = uid and cleared_at is null;
  update public.journal_entries set shared_with_ai = false, shared_at = null
  where user_id = uid and shared_with_ai;
  update ops.jobs_queue set done_at = now(), locked_at = null, lease = null, last_error = 'cleared'
  where user_id = uid and done_at is null and kind in ('summary', 'notes', 'moments', 'title', 'journal');
  delete from public.memory_notes           where user_id = uid;
  delete from public.memory_embeddings      where user_id = uid;
  delete from public.conversation_summaries where user_id = uid;
  insert into ops.data_requests (user_id, kind, status, completed_at)
  values (uid, 'clear_memory', 'done', now());
end $$;

-- Nightly: also hard-delete journal entries deleted more than 24 h ago.
create or replace function public.purge_expired()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  n_conv  int;
  n_ret   int;
  n_entry int;
begin
  delete from public.memory_embeddings e
  using public.conversations c
  where e.source = 'conversation_insight' and e.source_id = c.id
    and c.cleared_at < now() - interval '24 hours';

  delete from public.conversations where cleared_at < now() - interval '24 hours';
  get diagnostics n_conv = row_count;

  delete from public.message_retrievals where created_at < now() - interval '90 days';
  get diagnostics n_ret = row_count;

  delete from public.journal_entries where deleted_at < now() - interval '24 hours';
  get diagnostics n_entry = row_count;

  return jsonb_build_object('conversations', n_conv, 'retrievals', n_ret, 'journalEntries', n_entry);
end $$;

-- Screen 34 can say how many entries are shared.
create or replace function public.get_memory()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  uid uuid := private.require_uid();
  dek text := private.user_dek(uid);
begin
  return jsonb_build_object(
    'notes', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', n.id, 'category', n.category, 'key', n.key,
        'content', private.decrypt_with(dek, n.content_enc), 'updatedAt', n.updated_at)
        order by n.category, n.updated_at desc)
      from public.memory_notes n where n.user_id = uid), '[]'),
    'conversations', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', c.id, 'title', private.decrypt_with(dek, c.title_enc),
        'summary', private.decrypt_with(dek, s.summary_enc), 'updatedAt', s.updated_at)
        order by s.updated_at desc)
      from public.conversation_summaries s
      join public.conversations c on c.id = s.conversation_id
      where s.user_id = uid and c.cleared_at is null), '[]'),
    'momentsCount', (select count(*) from public.memory_embeddings where user_id = uid),
    'sharedEntriesCount', (select count(*) from public.journal_entries e
                           where e.user_id = uid and e.shared_with_ai and e.deleted_at is null));
end $$;

-- Access ---------------------------------------------------------------------------

revoke all on function public.journal_job_context(bigint, uuid)             from public, anon, authenticated;
revoke all on function public.journal_job_save(bigint, uuid, jsonb, jsonb)  from public, anon, authenticated;
revoke all on function public.enqueue_journal_memory(int)                   from public, anon, authenticated;
grant execute on function public.journal_job_context(bigint, uuid)            to service_role;
grant execute on function public.journal_job_save(bigint, uuid, jsonb, jsonb) to service_role;
grant execute on function public.enqueue_journal_memory(int)                  to service_role;

-- create or replace keeps the grants of the functions replaced above
-- (memory_search, purge_expired: service_role; clear_memory, get_memory:
-- authenticated).
