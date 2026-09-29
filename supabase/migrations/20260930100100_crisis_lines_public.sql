-- App wiring (C5): the app shows the crisis lines again when a conversation
-- with a crisis card is reopened, so the (confirmed) numbers are public config.
-- They are public information; the list stays empty until Claudia and the
-- lawyer confirm it (Q2).
update public.app_config set public = true where key = 'crisis.resources';
