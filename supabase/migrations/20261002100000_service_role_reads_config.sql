-- The chat function reads its settings from app_config with the service role.
-- On a project where new tables are not auto-exposed to the API roles, the
-- service role has no table privileges unless they are granted, and the
-- function failed before it could accept a message. Everything else the
-- function touches goes through security definer functions it can execute.
grant select on public.app_config to service_role;
