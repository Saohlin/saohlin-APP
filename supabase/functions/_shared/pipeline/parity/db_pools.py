#!/usr/bin/env python3
"""Fetch retrieve_all from the database for every prompt fixture.

The parity test then builds each prompt from what the DATABASE returned
(rather than from the Python retriever) and compares it with the Python
prompt, closing the loop database -> TypeScript -> identical prompt.

    DATABASE_URL=... python3 supabase/functions/_shared/pipeline/parity/db_pools.py
Writes parity/db_pools.json (git-ignored). Read-only: the two config flags it
changes are rolled back.
"""
import json
import os

import psycopg

here = os.path.dirname(os.path.abspath(__file__))
F = json.load(open(os.path.join(here, "fixtures.json"), encoding="utf-8"))
out = []
with psycopg.connect(os.environ["DATABASE_URL"]) as conn, conn.cursor() as cur:
    # The Python pipeline includes one-to-one readings and unapproved Phase 02
    # exemplars; compare like with like inside this transaction only.
    cur.execute("update public.app_config set value = 'false' where key = 'retrieval.exclude_personal_readings'")
    cur.execute("update public.app_config set value = 'true' where key = 'retrieval.include_unapproved_exemplars'")
    import numpy as np
    z = np.load(os.path.join(os.environ["SAOHLIN_BASE"], "corpus", "query_embeddings_cache.npz"), allow_pickle=True)
    cache = {str(k): v for k, v in zip(z["keys"], z["vectors"])}
    seen = {}
    for p in F["prompts"]:
        q = p["q"]
        if q in seen:
            out.append(seen[q])
            continue
        v = cache[q].astype(np.float32)
        v = v / max(np.linalg.norm(v), 1e-9)
        lit = "[" + ",".join(f"{x:.7g}" for x in v.tolist()) + "]"
        cur.execute("select public.retrieve_all(null, %s::extensions.vector, %s, "
                    "'{\"knowledge\":6,\"video\":2,\"guide\":3,\"realclient\":1}', null, array['PROTOKOL.pdf'], 0)",
                    (lit, q))
        seen[q] = cur.fetchone()[0]
        out.append(seen[q])
    conn.rollback()
json.dump(out, open(os.path.join(here, "db_pools.json"), "w", encoding="utf-8"), ensure_ascii=False)
print(f"wrote db_pools.json for {len(out)} prompts")
