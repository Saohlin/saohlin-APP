-- Claudia's comparison of three configurations (22 Oct 2026), see
-- functions/_shared/pipeline/variants.ts.
--   {"<user uuid>": "B"}  B = minimal identity + safety, no knowledge base
--   {"<user uuid>": "C"}  C = B + new communication instructions
-- Anyone not listed (all real users) keeps A, the current pipeline.
insert into public.app_config (key, value, description, public) values
  ('chat.variants', '{}', 'Test configuration per user: {"<user uuid>": "A"|"B"|"C"}. Missing = A (current pipeline).', false)
on conflict (key) do nothing;
