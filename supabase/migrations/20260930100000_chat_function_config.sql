-- Chat function (C4): the remaining configuration it reads.
--
-- model.params: extra request fields per model (for example reasoning effort),
--   merged into every call to that model.
-- model.prices: EUR per million tokens {in, cached, out} per model, for the
--   cost rows. Empty until the prices for the chosen models are confirmed;
--   cost is recorded as 0 meanwhile and tokens are always recorded.
-- chat.temperature: the Python pipeline's values (reply 0.7, planner 0). Set a
--   value to null for a model that does not accept temperature.

insert into public.app_config (key, value, description, public) values
  ('model.params',             '{}',   'Extra request fields per model, e.g. {"gpt-5.6-luna": {"reasoning_effort": "minimal"}}', false),
  ('model.prices',             '{}',   'EUR per 1M tokens per model: {"<model>": {"in": 0, "cached": 0, "out": 0}}', false),
  ('chat.temperature',         '{"reply": 0.7, "planner": 0}', 'Sampling temperature; null leaves it to the model', false),
  ('chat.max_tokens_per_word', '3',    'Output token ceiling per word of the mode budget (x1.3 margin)', false),
  ('memory.search_limit',      '3',    'Layer 4 moments searched when a message refers to the past', false)
on conflict (key) do nothing;
