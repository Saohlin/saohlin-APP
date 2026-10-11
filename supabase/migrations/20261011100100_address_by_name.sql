-- Users are addressed by the name they typed, not by a derived Czech vocative.
-- New and edited profiles already store vocative = display name from the app;
-- this brings existing rows in line so CLAUDIA AI and the chat greeting agree.
update public.profiles
   set vocative = left(btrim(display_name), 60)
 where btrim(display_name) <> ''
   and vocative is distinct from left(btrim(display_name), 60);
