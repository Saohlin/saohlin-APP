-- gpt-5.6 models reject a custom temperature (unsupported_value); they accept
-- only their default. null means "send no temperature". Also clears the
-- stop-gap override in model.params if it was applied by hand.
update public.app_config set value = '{"reply": null, "planner": null}' where key = 'chat.temperature';
update public.app_config
set value = (value #- '{gpt-5.6-terra,temperature}') #- '{gpt-5.6-luna,temperature}'
where key = 'model.params';
