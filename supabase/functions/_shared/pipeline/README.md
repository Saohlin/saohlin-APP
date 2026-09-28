# CLAUDIA AI pipeline (TypeScript)

The port of `AI APP/scripts/` (stage8_chat, response_modes, voice_checks_v2,
stage10_voice_score, stage6 BM25) that the `chat` Edge Function runs. Platform
neutral: no Deno or Supabase APIs in here, so it runs in the function and in tests.

| File | What it does | Python original |
|---|---|---|
| `modes.ts` | seven modes, deterministic routing, planner, understanding gate, mode block | `response_modes.py` |
| `checks.ts` | hard checks and soft flags on a reply | `voice_checks_v2.py`, `stage10_voice_score.py` |
| `prompt.ts` | selection from retrieved pools, message assembly, memory block, crisis block | `stage8_chat.Retriever`, `build_messages` |
| `bm25.ts` | lexical search over the small collections | `stage6_retrieval_eval.BM25` |
| `vocative.ts` | Czech 5th case fallback (the stored profile value wins) | `stage8_chat.vocative` |
| `gate.ts` | sentence-gated release, prompt-leak check, corrective continuation | new (Chat Module Spec) |
| `crisis.ts` | keyword screen and classifier | new (Chat Module Spec, G2.7) |
| `query.ts` | retrieval query (current + previous user turn + what is unknown) | new (fixes PROJECT_STATUS A4) |
| `pyre.ts` | Python regex semantics in JavaScript (Unicode `\w`, `\b`) | — |
| `constants.json` | mode texts, planner prompt, patterns, phrase lists | exported by `parity/export_constants.py` |

## Parity

The port is held to the Python by recording what the Python does and replaying it:

```bash
AI="/path/to/AI APP"
python3 supabase/functions/_shared/pipeline/parity/export_constants.py --base "$AI"   # after any Python change
python3 supabase/functions/_shared/pipeline/parity/oracle.py --base "$AI"
SAOHLIN_BASE="$AI" DATABASE_URL=... python3 supabase/functions/_shared/pipeline/parity/db_pools.py   # optional
deno test -A supabase/functions/_shared/pipeline/
```

What is compared: routing of 121 messages, the understanding gate on 306
conversations, her 20 round 1 items (20/20 routed, 17/20 caught), 252 mode
blocks, hard checks and soft flags on 2,141 texts, 66 vocatives, BM25 picks,
the planner prompt, and 156 full prompts byte for byte, both from the Python's
retrieval and from the database's. The fixtures contain her knowledge base
and are git-ignored.

Differences from the Python, all deliberate and all outside the parity cases:

- memory (layers 1-4) is a second system message; omitted when empty, so
  prompts without memory are byte-identical;
- the vocative comes from the stored profile, not from the rule;
- the retrieval query adds the previous user turn and the planner's `chybi`;
- crisis: keyword screen + classifier, forced HRANICE with a crisis block;
- sentence-gated streaming with one corrective continuation, instead of a
  full-reply retry;
- a prompt-leak check (8 words shared with the persona or always-on rules).
