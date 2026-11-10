-- Admin panel, parts 1 and 2: the admin foundation and Claudia's testing mode.
--
-- Testers: accounts whose chats may be reviewed. Only a tester can mark an
--   answer, and only a tester's conversations can ever be opened by an admin.
--   Set by hand in the SQL editor with ops.set_tester(email, on).
-- Admins: accounts with app_metadata.saohlin_admin = true (set by SQL; users
--   cannot edit app_metadata). The `admin` Edge Function checks the flag and
--   two-factor (aal2) from the verified token; every admin_* function below
--   checks the flag again from auth.users.
-- Admin functions are service-role only and take the admin's id first, read by
--   the Edge Function from the verified token, never from a request body.
-- Every admin read of decrypted test data and every change writes one row to
--   ops.admin_log from inside the same function: ids and codes, never text.

-- Tables -------------------------------------------------------------------------

create table private.testers (
  user_id  uuid primary key references auth.users (id) on delete cascade,
  added_at timestamptz not null default now(),
  note     text check (char_length(note) <= 200)
);
alter table private.testers enable row level security;
revoke all on private.testers from public, anon, authenticated, service_role;

create table ops.mark_reviews (
  mark_id    uuid primary key references public.answer_marks (id) on delete cascade,
  status     text not null default 'new' check (status in ('new', 'in_progress', 'fixed', 'wont_fix')),
  comment    text check (char_length(comment) <= 2000),
  updated_by uuid references auth.users (id) on delete set null,
  updated_at timestamptz not null default now()
);
alter table ops.mark_reviews enable row level security;
revoke all on ops.mark_reviews from public, anon, authenticated, service_role;

create table ops.admin_log (
  id         bigint generated always as identity primary key,
  admin_id   uuid references auth.users (id) on delete set null,
  action     text not null check (action ~ '^[a-z][a-z0-9_.]{1,63}$'),
  target     text check (char_length(target) <= 100),
  detail     jsonb not null default '{}' check (jsonb_typeof(detail) = 'object'),
  created_at timestamptz not null default now()
);
alter table ops.admin_log enable row level security;
revoke all on ops.admin_log from public, anon, authenticated, service_role;
create index admin_log_created_idx on ops.admin_log (created_at desc);

-- Helpers ------------------------------------------------------------------------

create or replace function private.is_tester(p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from private.testers t where t.user_id = p_user)
$$;

create or replace function private.is_admin(p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select u.raw_app_meta_data ->> 'saohlin_admin' = 'true'
                   from auth.users u where u.id = p_user), false)
$$;

create or replace function private.require_admin(p_admin uuid)
returns void
language plpgsql
stable
set search_path = ''
as $$
begin
  if p_admin is null or not private.is_admin(p_admin) then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
end $$;

create or replace function private.admin_log(p_admin uuid, p_action text, p_target text, p_detail jsonb)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into ops.admin_log (admin_id, action, target, detail)
  values (p_admin, p_action, p_target, coalesce(p_detail, '{}'::jsonb))
$$;

revoke all on function private.is_tester(uuid) from public, anon, authenticated;
revoke all on function private.is_admin(uuid) from public, anon, authenticated;
revoke all on function private.require_admin(uuid) from public, anon, authenticated;
revoke all on function private.admin_log(uuid, text, text, jsonb) from public, anon, authenticated;

-- Only testers can mark answers ----------------------------------------------------
-- A trigger rather than a row policy: the app's role has no access to the private
-- schema, and a trigger function runs as its owner. The existing policies still
-- limit a user to marking their own answers.

create or replace function private.answer_marks_testers_only()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.is_tester(new.user_id) then
    raise exception 'NOT_TESTER' using errcode = '42501';
  end if;
  return new;
end $$;
revoke all on function private.answer_marks_testers_only() from public, anon, authenticated;

create trigger answer_marks_testers_only
  before insert on public.answer_marks
  for each row execute function private.answer_marks_testers_only();

-- get_me: as in 20260929100200_chat_rpc.sql, plus `tester` --------------------------

create or replace function public.get_me()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'userId',        u.id,
    'email',         u.email,
    'emailVerified', u.email_confirmed_at is not null,
    'tester',        private.is_tester(u.id),
    'profile', jsonb_build_object(
      'displayName', p.display_name,
      'vocative',    p.vocative,
      'firstName',   p.first_name,
      'lastName',    p.last_name,
      'dateOfBirth', private.decrypt(u.id, p.date_of_birth_enc),
      'gender',      p.gender,
      'zodiac',      p.zodiac
    ),
    'context', jsonb_strip_nulls(jsonb_build_object(
      'work',      private.decrypt(u.id, c.work_enc),
      'situation', private.decrypt(u.id, c.situation_enc),
      'blocking',  private.decrypt(u.id, c.blocking_enc),
      'visions',   private.decrypt(u.id, c.visions_enc)
    )),
    'onboarding', jsonb_strip_nulls(jsonb_build_object(
      'consentGrantedAt',   p.consent_granted_at,
      'profileCompletedAt', p.profile_completed_at,
      'deeperCompletedAt',  p.deeper_completed_at,
      'aiPausedAt',         p.ai_processing_paused_at
    )),
    'entitlement', jsonb_build_object(
      'active',         private.is_paid(u.id),
      'plan',           e.plan,
      'periodEndsAt',   e.period_ends_at,
      'trialTotal',     private.config_int('trial.total_replies', 5),
      'trialRemaining', private.trial_remaining(u.id)
    ),
    'settings', jsonb_build_object(
      'notifications', s.notifications,
      'voicePlayback', s.voice_playback,
      'haptics',       s.haptics
    )
  )
  from auth.users u
  join public.profiles p on p.user_id = u.id
  left join public.user_context c on c.user_id = u.id
  left join public.user_settings s on s.user_id = u.id
  left join public.entitlements e on e.user_id = u.id
  where u.id = auth.uid()
$$;

-- Testers, by email. Run from the SQL editor only. ------------------------------------

create or replace function ops.set_tester(p_email text, p_on boolean default true)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid;
begin
  select id into uid from auth.users where lower(email) = lower(btrim(p_email));
  if uid is null then
    return 'no account with that email yet: sign up in the app first, then run this again';
  end if;
  if p_on then
    insert into private.testers (user_id) values (uid) on conflict do nothing;
    return 'tester on';
  end if;
  delete from private.testers where user_id = uid;
  return 'tester off';
end $$;
revoke all on function ops.set_tester(text, boolean) from public, anon, authenticated, service_role;

-- Admin functions (service role only) ---------------------------------------------------

-- Counts for the overview. Testers' marks only; no text.
create or replace function public.admin_overview(p_admin uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  marks jsonb;
  statuses jsonb;
begin
  perform private.require_admin(p_admin);

  select coalesce(jsonb_object_agg(k.mark, k.n), '{}') into marks
  from (select am.mark::text as mark, count(*) as n
        from public.answer_marks am join private.testers t on t.user_id = am.user_id
        group by am.mark) k;

  select coalesce(jsonb_object_agg(k.status, k.n), '{}') into statuses
  from (select coalesce(rv.status, 'new') as status, count(*) as n
        from public.answer_marks am
        join private.testers t on t.user_id = am.user_id
        left join ops.mark_reviews rv on rv.mark_id = am.id
        group by 1) k;

  return jsonb_build_object(
    'testers', (select count(*) from private.testers),
    'marks', marks,
    'statuses', statuses);
end $$;

-- One page of testers' marks, newest first, with short excerpts.
create or replace function public.admin_testing_list(
  p_admin  uuid,
  p_mark   public.answer_mark default null,
  p_status text default null,
  p_limit  int default 25,
  p_offset int default 0)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  lim   int := least(greatest(coalesce(p_limit, 25), 1), 100);
  off   int := greatest(coalesce(p_offset, 0), 0);
  total int;
  items jsonb;
begin
  perform private.require_admin(p_admin);
  if p_status is not null and p_status not in ('new', 'in_progress', 'fixed', 'wont_fix') then
    raise exception 'INVALID_INPUT' using errcode = '22023';
  end if;

  select count(*) into total
  from public.answer_marks am
  join private.testers t on t.user_id = am.user_id
  left join ops.mark_reviews rv on rv.mark_id = am.id
  where (p_mark is null or am.mark = p_mark)
    and (p_status is null or coalesce(rv.status, 'new') = p_status);

  select coalesce(jsonb_agg(jsonb_build_object(
      'markId',     m.id,
      'mark',       m.mark,
      'note',       m.note,
      'markedAt',   m.created_at,
      'status',     m.status,
      'messageId',  m.message_id,
      'conversationId', a.conversation_id,
      'tester',     u.email,
      'mode',       a.mode,
      'question',   left(private.decrypt(m.user_id, q.content_enc), 160),
      'answer',     left(private.decrypt(m.user_id, a.content_enc), 160))
      order by m.created_at desc, m.id), '[]')
  into items
  from (
    select am.id, am.mark, am.note, am.created_at, am.user_id, am.message_id,
           coalesce(rv.status, 'new') as status
    from public.answer_marks am
    join private.testers t on t.user_id = am.user_id
    left join ops.mark_reviews rv on rv.mark_id = am.id
    where (p_mark is null or am.mark = p_mark)
      and (p_status is null or coalesce(rv.status, 'new') = p_status)
    order by am.created_at desc, am.id
    limit lim offset off
  ) m
  join public.messages a on a.id = m.message_id
  left join public.messages q on q.id = a.reply_to
  left join auth.users u on u.id = m.user_id;

  perform private.admin_log(p_admin, 'testing.list', null,
    jsonb_build_object('shown', jsonb_array_length(items), 'total', total,
                       'mark', p_mark, 'status', p_status, 'offset', off));

  return jsonb_build_object('items', items, 'total', total, 'limit', lim, 'offset', off);
end $$;

-- One mark in full: the exchange, what was retrieved, all marks on the answer, the review.
create or replace function public.admin_testing_get(p_admin uuid, p_mark_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  am     public.answer_marks%rowtype;
  a      public.messages%rowtype;
  q      public.messages%rowtype;
  dek    text;
  result jsonb;
begin
  perform private.require_admin(p_admin);

  select m.* into am from public.answer_marks m
  join private.testers t on t.user_id = m.user_id
  where m.id = p_mark_id;
  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;

  select * into a from public.messages where id = am.message_id;
  select * into q from public.messages where id = a.reply_to;
  dek := private.user_dek(am.user_id);

  result := jsonb_build_object(
    'markId',  am.id,
    'tester',  (select email from auth.users where id = am.user_id),
    'conversationId', a.conversation_id,
    'question', case when q.id is null then null else jsonb_build_object(
      'id', q.id, 'text', private.decrypt_with(dek, q.content_enc), 'createdAt', q.created_at) end,
    'answer', jsonb_build_object(
      'id', a.id, 'text', private.decrypt_with(dek, a.content_enc), 'mode', a.mode,
      'status', a.status, 'createdAt', a.created_at),
    'earlier', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', e.id, 'role', e.role, 'text', private.decrypt_with(dek, e.content_enc),
        'createdAt', e.created_at) order by e.created_at)
      from (select * from public.messages
            where conversation_id = a.conversation_id and role in ('user', 'assistant')
              and created_at < coalesce(q.created_at, a.created_at)
            order by created_at desc limit 6) e), '[]'),
    'meta', (select jsonb_build_object(
      'model', mm.model, 'mode', mm.mode, 'plannerHow', mm.planner_how,
      'understanding', mm.understanding, 'timings', mm.timings,
      'hardFailures', to_jsonb(mm.hard_failures), 'retried', mm.retried,
      'degraded', mm.degraded, 'crisisFlag', mm.crisis_flag,
      'tokensIn', mm.tokens_in, 'tokensCached', mm.tokens_cached, 'tokensOut', mm.tokens_out)
      from public.message_meta mm where mm.message_id = a.id),
    'retrieved', coalesce((
      select jsonb_agg(jsonb_build_object(
        'collection', r.collection, 'slot', r.slot, 'score', r.score, 'itemId', r.item_id,
        'topic', case when r.collection = 'exemplar' then left(x.situation, 80)
                      else coalesce(c.topic, c.guide_name) end,
        'text', case
          when r.collection = 'exemplar' then
            case when x.id is null then null
                 else 'Situace: ' || x.situation || E'\n\nOdpověď: ' || x.claudia_response end
          when r.collection = 'memory' then private.decrypt_with(dek, me.content_enc)
          else c.text end)
        order by r.collection, r.slot)
      from public.message_retrievals r
      left join kb.chunks c on r.collection not in ('exemplar', 'memory') and c.id = r.item_id
      left join kb.exemplars x on r.collection = 'exemplar' and x.id = r.item_id
      left join public.memory_embeddings me
        on r.collection = 'memory' and me.id::text = r.item_id and me.user_id = am.user_id
      where r.message_id = a.id), '[]'),
    'marks', (
      select jsonb_agg(jsonb_build_object(
        'markId', m.id, 'mark', m.mark, 'note', m.note, 'markedAt', m.created_at)
        order by m.created_at)
      from public.answer_marks m where m.message_id = a.id and m.user_id = am.user_id),
    'review', coalesce((
      select jsonb_build_object('status', rv.status, 'comment', rv.comment,
                                'updatedAt', rv.updated_at,
                                'updatedBy', (select email from auth.users where id = rv.updated_by))
      from ops.mark_reviews rv where rv.mark_id = am.id),
      jsonb_build_object('status', 'new', 'comment', null, 'updatedAt', null, 'updatedBy', null)));

  perform private.admin_log(p_admin, 'testing.get', am.id::text, '{}'::jsonb);
  return result;
end $$;

-- Sets the review of a mark. Returns the saved review.
create or replace function public.admin_testing_review(
  p_admin   uuid,
  p_mark_id uuid,
  p_status  text,
  p_comment text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  old_status text;
  clean      text := nullif(btrim(p_comment), '');
  saved      ops.mark_reviews%rowtype;
begin
  perform private.require_admin(p_admin);
  if p_status is null or p_status not in ('new', 'in_progress', 'fixed', 'wont_fix')
     or char_length(clean) > 2000 then
    raise exception 'INVALID_INPUT' using errcode = '22023';
  end if;
  if not exists (select 1 from public.answer_marks m join private.testers t on t.user_id = m.user_id
                 where m.id = p_mark_id) then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;

  select status into old_status from ops.mark_reviews where mark_id = p_mark_id;

  insert into ops.mark_reviews (mark_id, status, comment, updated_by, updated_at)
  values (p_mark_id, p_status, clean, p_admin, now())
  on conflict (mark_id) do update
    set status = excluded.status, comment = excluded.comment,
        updated_by = excluded.updated_by, updated_at = excluded.updated_at
  returning * into saved;

  perform private.admin_log(p_admin, 'testing.review', p_mark_id::text,
    jsonb_build_object('from', coalesce(old_status, 'new'), 'to', p_status));

  return jsonb_build_object('status', saved.status, 'comment', saved.comment,
                            'updatedAt', saved.updated_at);
end $$;

revoke all on function public.admin_overview(uuid) from public, anon, authenticated;
revoke all on function public.admin_testing_list(uuid, public.answer_mark, text, int, int) from public, anon, authenticated;
revoke all on function public.admin_testing_get(uuid, uuid) from public, anon, authenticated;
revoke all on function public.admin_testing_review(uuid, uuid, text, text) from public, anon, authenticated;
grant execute on function public.admin_overview(uuid) to service_role;
grant execute on function public.admin_testing_list(uuid, public.answer_mark, text, int, int) to service_role;
grant execute on function public.admin_testing_get(uuid, uuid) to service_role;
grant execute on function public.admin_testing_review(uuid, uuid, text, text) to service_role;
