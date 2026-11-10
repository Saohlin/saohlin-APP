-- Knowledge base (C2): Claudia's material, schema `kb`, service role only.
--
-- The app never reads kb.*. Nothing users say is ever written here: the only
-- writers are supabase/seed/load_kb.py and, later, the admin panel, whose
-- additions wait as 'pending_approval' until Claudia approves them.
--
-- Search is exact (a scan over one collection, ordered by cosine distance),
-- not HNSW. At about 3,000 passages an exact scan takes a few milliseconds and
-- returns the same top k as the Python pipeline every time, which an
-- approximate index filtered by collection does not guarantee. Add partial
-- HNSW indexes per collection if a collection grows past ~20,000 rows.

create type public.kb_status as enum ('draft', 'pending_approval', 'approved', 'archived');

create schema if not exists kb;
revoke all on schema kb from public, anon, authenticated;
grant usage on schema kb to service_role;
alter default privileges in schema kb revoke execute on functions from public;

create table kb.documents (
  id               uuid primary key default gen_random_uuid(),
  collection       text not null,
  source_file      text not null,
  title            text not null,
  status           public.kb_status not null default 'approved',
  personal_reading boolean not null default false,
  approved_at      timestamptz,
  created_at       timestamptz not null default now(),
  unique (collection, source_file)
);

-- One row per passage. Collections:
--   knowledge        her Phase 01 written texts (dense)
--   video            HeroHero transcripts (dense, guaranteed slots)
--   guide            Guide passages, KB 02 (dense)
--   realclient       instruction prose from her real client documents (dense)
--   guide_principle  per-guide principles (lexical, in the chat function)
--   framework        card-conversation framework (lexical, KARTA only)
--   style_source     identity, safety and behaviour rules; `always` in meta
--                    marks the ones sent on every turn
--   guide_map        23 orientation entries, looked up by guide, never searched
create table kb.chunks (
  id               text primary key,
  document_id      uuid not null references kb.documents (id) on delete cascade,
  collection       text not null check (collection in ('knowledge', 'video', 'guide', 'realclient',
                                                       'guide_principle', 'framework', 'style_source', 'guide_map')),
  chunk_index      int not null default 0,
  guide_name       text,
  topic            text,
  text             text not null,
  text_search      tsvector generated always as (to_tsvector('simple', public.f_unaccent(lower(text)))) stored,
  embedding        extensions.vector(1024),
  word_count       int,
  meta             jsonb not null default '{}',
  personal_reading boolean not null default false,
  excluded         boolean not null default false,
  status           public.kb_status not null default 'approved',
  created_at       timestamptz not null default now()
);
create index chunks_collection_idx on kb.chunks (collection) where not excluded;
create index chunks_guide_idx on kb.chunks (guide_name) where guide_name is not null;
create index chunks_text_search_idx on kb.chunks using gin (text_search);

-- Style layer: her situation -> answer pairs, injected as real turns.
create table kb.exemplars (
  id                  text primary key,
  bank                text not null check (bank in ('phase01', 'feedback_r1', 'realclient_p2')),
  situation           text not null,
  claudia_response    text not null,
  mode                public.response_mode,
  subtype             text,
  pair_type           text not null default 'turn_pair',
  verbatim            boolean not null default true,
  opens_with_greeting boolean not null default false,
  word_count          int not null,
  embedding           extensions.vector(1024),
  approved_by_claudia boolean not null default false,
  excluded_reason     text,
  meta                jsonb not null default '{}',
  created_at          timestamptz not null default now()
);

-- Always-on layer. Exactly one active version; message_meta can be traced to it.
create table kb.persona_versions (
  id                uuid primary key default gen_random_uuid(),
  version           text not null unique,
  style_card        text not null,
  identity_sentence text not null,
  active            boolean not null default false,
  created_at        timestamptz not null default now()
);
create unique index one_active_persona on kb.persona_versions (active) where active;

-- Voice-check rules, versioned so the parity suite can pin them.
create table kb.check_rules (
  version    text primary key,
  rules      jsonb not null,
  active     boolean not null default false,
  created_at timestamptz not null default now()
);
create unique index one_active_check_rules on kb.check_rules (active) where active;

create table kb.embedding_lock (
  singleton boolean primary key default true check (singleton),
  model     text not null default 'text-embedding-3-large',
  dims      int not null default 1024,
  locked_at timestamptz not null default now()
);
insert into kb.embedding_lock default values;

alter table kb.documents        enable row level security;
alter table kb.chunks           enable row level security;
alter table kb.exemplars        enable row level security;
alter table kb.persona_versions enable row level security;
alter table kb.check_rules      enable row level security;
alter table kb.embedding_lock   enable row level security;

revoke all on all tables in schema kb from public, anon, authenticated;
grant all on all tables in schema kb to service_role;

insert into public.app_config (key, value, description, public) values
  ('retrieval.exclude_personal_readings', 'true',
   'Leave out the 207 passages from one-to-one paid readings (her 10 August decision; open question Q6)', false),
  ('retrieval.include_unapproved_exemplars', 'false',
   'Use Phase 02 exemplars before Claudia approves them (open question Q5)', false),
  ('retrieval.lexical_weight', '0.0',
   'Weight of the lexical arm in knowledge search (stage6 sweep: dense only holds 92.3% top 5)', false)
on conflict (key) do nothing;

-- Search ---------------------------------------------------------------------------

-- One collection, nearest first. Reciprocal-rank fusion with the lexical arm
-- when its weight is above zero (rrf_k 60, depth 40, as in fusion_config.json).
create or replace function kb.search_chunks(
  q_embedding      extensions.vector,
  q_text           text,
  p_collection     text,
  p_limit          int,
  p_lexical_weight real default 0.0,
  p_guide          text default null)
returns table (id text, score real)
language sql
stable
set search_path = ''
as $$
  with allowed as (
    select c.* from kb.chunks c
    where c.collection = p_collection and not c.excluded and c.status = 'approved'
      and (p_guide is null or c.guide_name = p_guide)
      and not (c.personal_reading and coalesce((select (value #>> '{}')::boolean from public.app_config
                                                where key = 'retrieval.exclude_personal_readings'), true))
  ),
  dense as (
    select a.id, row_number() over (order by a.embedding operator(extensions.<=>) q_embedding, a.id) as r,
           1 - (a.embedding operator(extensions.<=>) q_embedding) as sim
    from allowed a
    where q_embedding is not null and a.embedding is not null
    order by a.embedding operator(extensions.<=>) q_embedding, a.id
    limit 40
  ),
  lex as (
    select a.id, row_number() over (order by ts_rank(a.text_search, q) desc, a.id) as r
    from allowed a, plainto_tsquery('simple', public.f_unaccent(lower(coalesce(q_text, '')))) q
    where p_lexical_weight > 0 and a.text_search @@ q
    order by ts_rank(a.text_search, q) desc, a.id
    limit 40
  )
  select coalesce(d.id, l.id),
         case when p_lexical_weight > 0
              then (coalesce(1.0 / (60 + d.r - 1), 0) * (1 - p_lexical_weight)
                    + coalesce(1.0 / (60 + l.r - 1), 0) * p_lexical_weight)::real
              else d.sim::real end
  from dense d full join lex l on l.id = d.id
  order by 2 desc, 1
  limit greatest(p_limit, 0)
$$;

-- Everything the chat function retrieves for one turn, in one call.
--
-- p_limits: { knowledge, video, guide, realclient } -- the largest budget of
--   any mode; the chosen mode trims it in the function.
-- p_guide: restrict guide passages to one guide (KARTA).
-- p_pinned: source files whose knowledge passages are always included (PAUZA).
-- p_memory: how many layer 4 moments to search (0 = skip).
-- Exemplars come back as the whole eligible set with their similarity: the
-- bank ordering rules are applied in the function, as in the Python pipeline.
create or replace function public.retrieve_all(
  p_user        uuid,
  q_embedding   extensions.vector,
  q_text        text,
  p_limits      jsonb default '{"knowledge": 6, "video": 2, "guide": 2, "realclient": 1}',
  p_guide       text default null,
  p_pinned      text[] default '{}',
  p_memory      int default 0)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  lexw real := coalesce((select (value #>> '{}')::real from public.app_config where key = 'retrieval.lexical_weight'), 0);
  unapproved boolean := coalesce((select (value #>> '{}')::boolean from public.app_config
                                  where key = 'retrieval.include_unapproved_exemplars'), false);
  result jsonb := '{}';
  coll text;
begin
  foreach coll in array array['knowledge', 'video', 'guide', 'realclient'] loop
    result := result || jsonb_build_object(coll, coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', c.id, 'score', s.score, 'topic', c.topic, 'guideName', c.guide_name,
        'text', c.text, 'wordCount', c.word_count, 'meta', c.meta) order by s.score desc, c.id)
      from kb.search_chunks(q_embedding, q_text, coll, coalesce((p_limits ->> coll)::int, 0),
                            case when coll = 'knowledge' then lexw else 0 end,
                            case when coll = 'guide' then p_guide end) s
      join kb.chunks c on c.id = s.id), '[]'));
  end loop;

  result := result || jsonb_build_object('pinned', coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', c.id, 'topic', c.topic, 'text', c.text, 'wordCount', c.word_count, 'meta', c.meta)
      order by c.meta ->> 'source_file', c.chunk_index)
    from kb.chunks c
    where c.collection = 'knowledge' and not c.excluded
      and exists (select 1 from unnest(p_pinned) p where strpos(c.meta ->> 'source_file', p) > 0)), '[]'));

  result := result || jsonb_build_object('exemplars', coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', e.id, 'bank', e.bank, 'situation', e.situation, 'claudiaResponse', e.claudia_response,
      'mode', e.mode, 'subtype', e.subtype, 'wordCount', e.word_count,
      'opensWithGreeting', e.opens_with_greeting,
      'score', case when q_embedding is null or e.embedding is null then null
                    else (1 - (e.embedding operator(extensions.<=>) q_embedding))::real end)
      order by e.id)
    from kb.exemplars e
    where e.pair_type = 'turn_pair' and e.excluded_reason is null
      and (e.approved_by_claudia or unapproved)), '[]'));

  if p_memory > 0 and q_embedding is not null then
    result := result || jsonb_build_object('memory', coalesce((
      select jsonb_agg(jsonb_build_object('id', m.id, 'source', m.source, 'content', m.content,
                                          'occurredAt', m.occurred_at, 'score', m.similarity)
                       order by m.similarity desc)
      from public.memory_search(p_user, q_embedding, p_memory) m), '[]'));
  else
    result := result || '{"memory": []}'::jsonb;
  end if;

  return result;
end $$;

-- The fixed layers: persona, check rules and the small lexical collections.
-- The chat function reads this once per instance and caches it.
create or replace function public.get_kb_static()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'persona', (select jsonb_build_object('version', p.version, 'styleCard', p.style_card,
                                          'identitySentence', p.identity_sentence)
                from kb.persona_versions p where p.active),
    'checkRules', (select jsonb_build_object('version', r.version, 'rules', r.rules)
                   from kb.check_rules r where r.active),
    'collections', coalesce((
      select jsonb_object_agg(collection, rows) from (
        select c.collection, jsonb_agg(jsonb_build_object(
          'id', c.id, 'topic', c.topic, 'guideName', c.guide_name, 'text', c.text,
          'wordCount', c.word_count, 'meta', c.meta) order by c.meta ->> 'order', c.id) as rows
        from kb.chunks c
        where c.collection in ('style_source', 'guide_principle', 'framework', 'guide_map')
          and not c.excluded and c.status = 'approved'
        group by c.collection) g), '{}'))
$$;

revoke all on function kb.search_chunks(extensions.vector, text, text, int, real, text) from public, anon, authenticated;
revoke all on function public.retrieve_all(uuid, extensions.vector, text, jsonb, text, text[], int) from public, anon, authenticated;
revoke all on function public.get_kb_static() from public, anon, authenticated;
grant execute on function kb.search_chunks(extensions.vector, text, text, int, real, text) to service_role;
grant execute on function public.retrieve_all(uuid, extensions.vector, text, jsonb, text, text[], int) to service_role;
grant execute on function public.get_kb_static() to service_role;
