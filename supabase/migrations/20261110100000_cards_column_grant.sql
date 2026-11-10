-- Re-applies the column grant on public.cards.
--
-- 20261106100000_admin_cards.sql first granted SELECT on the whole table to
-- signed-in users, which also exposed `meaning` (for CLAUDIA AI only) and
-- `updated_by`. The file was changed on 9 Nov to a column grant, but a database
-- that had already applied the first version keeps the table-wide grant, since a
-- migration never runs twice. This makes the result the same everywhere.
--
-- Revoking the table privilege also revokes any column privileges, so the
-- grant below is the only read access left. Safe to run more than once.

revoke select on public.cards from authenticated;
grant select (id, position, name, keywords, quote, message, step, mantra, art_path, status, updated_at)
  on public.cards to authenticated;
