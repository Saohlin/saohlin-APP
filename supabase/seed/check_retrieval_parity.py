#!/usr/bin/env python3
"""Prove the database retrieves what the Python pipeline retrieves.

Runs the 78-case Czech test set (both accented and diacritics-stripped queries,
from the cached query embeddings, so no OpenAI call) through:

  - the Python pipeline, stage8_chat.Retriever, the code Claudia's calibration
    rounds were run on;
  - kb.search_chunks / public.retrieve_all in Postgres, after load_kb.py.

and checks that:

  1. row counts match the corpus files;
  2. for every query, knowledge top 5, video top 2, guides top 2 and real-client
     top 1 are the same passages in the same order;
  3. exemplar similarities agree to within 1e-4;
  4. G2.1 (correct source in top 5, gate 85%) and G2.2 (same top 5 without
     diacritics, gate 90%) score the same as stage6 measured: 92.3% top 5.

    DATABASE_URL=postgresql://... python supabase/seed/check_retrieval_parity.py \\
        --base "/path/to/AI APP"

Exit code 0 only if everything matches.
"""
import argparse
import json
import os
import sys
import unicodedata

import numpy as np


def nfc(s):
    return unicodedata.normalize("NFC", s)


def unaccent(s):
    return "".join(c for c in unicodedata.normalize("NFD", s) if unicodedata.category(c) != "Mn")


def vec_literal(v):
    return "[" + ",".join(f"{x:.7g}" for x in v.tolist()) + "]"


def top_sources(ids, src_of, k=5):
    seen, out = set(), []
    for i in ids:
        s = nfc(os.path.basename(src_of[i]))
        if s not in seen:
            seen.add(s)
            out.append(s)
        if len(out) >= k:
            break
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", required=True)
    ap.add_argument("--dsn", default=os.environ.get("DATABASE_URL"))
    args = ap.parse_args()
    os.environ["SAOHLIN_BASE"] = args.base
    sys.path.insert(0, os.path.join(args.base, "scripts"))
    import stage8_chat  # noqa: E402  the Python pipeline itself
    import psycopg

    corpus = os.path.join(args.base, "corpus")
    cases = json.load(open(os.path.join(corpus, "retrieval_testset_cz.json"), encoding="utf-8"))["cases"]
    z = np.load(os.path.join(corpus, "query_embeddings_cache.npz"), allow_pickle=True)
    cache = {str(k): v for k, v in zip(z["keys"], z["vectors"])}

    r = stage8_chat.Retriever()
    failures = []

    with psycopg.connect(args.dsn) as conn, conn.cursor() as cur:
        # 1. counts
        expected = {"knowledge": len(r.chunks), "video": len(r.videos), "guide": len(r.guides),
                    "realclient": len(r.clients), "guide_principle": len(r.guide_rules),
                    "framework": len(r.phase2_rules), "style_source": len(r.styles),
                    "guide_map": len(r.guide_map)}
        cur.execute("select collection, count(*) from kb.chunks group by collection")
        got = dict(cur.fetchall())
        for coll, n in expected.items():
            if got.get(coll) != n:
                failures.append(f"count {coll}: db {got.get(coll)} vs corpus {n}")
        cur.execute("select count(*) from kb.exemplars")
        if cur.fetchone()[0] != len(r.exemplars):
            failures.append("exemplar count differs")
        print(f"counts: {got}")

        # Python keeps one-to-one readings in its index; the database leaves them
        # out by default (her 10 August decision). Compare like with like.
        cur.execute("update public.app_config set value = 'false' where key = 'retrieval.exclude_personal_readings'")

        cur.execute("select id, meta ->> 'source_file' from kb.chunks where collection = 'knowledge'")
        src_of = dict(cur.fetchall())
        cur.execute("select id, embedding::text from kb.exemplars where embedding is not null")
        ex_vec = {i: np.array(json.loads(v), dtype=np.float32) for i, v in cur.fetchall()}

        def sql_top(q, qv, coll, k):
            cur.execute("select id from kb.search_chunks(%s::extensions.vector, %s, %s, %s, 0)",
                        (vec_literal(qv), q, coll, k))
            return [row[0] for row in cur.fetchall()]

        hit5 = stable = hit5_u = 0
        for c in cases:
            acc = {nfc(a) for a in c["accept"]}
            tops = {}
            for variant, q in (("a", c["q"]), ("u", unaccent(c["q"]))):
                qv = cache[q].astype(np.float32)
                qv = qv / max(np.linalg.norm(qv), 1e-9)
                py = {
                    "knowledge": [x["id"] for x in r.search_knowledge(q, qv, k=5)],
                    "video": [x["id"] for x in r.search_video(q, qv, k=2)],
                    "guide": [x["id"] for x in r.search_guides(q, qv, k=2)],
                    "realclient": [x["id"] for x in r.search_clients(q, qv, k=1)],
                }
                for coll, k in (("knowledge", 5), ("video", 2), ("guide", 2), ("realclient", 1)):
                    db = sql_top(q, qv, coll, k)
                    if db != [nfc(x) for x in py[coll]]:
                        failures.append(f"{coll} differs for {q!r}: db {db} vs python {py[coll]}")
                tops[variant] = top_sources(sql_top(q, qv, "knowledge", 40), src_of)
                # exemplar similarities
                for eid, ev in ex_vec.items():
                    pos = r.dense_e["ids"].index(eid)
                    diff = abs(float(ev @ qv) - float(r.dense_e["V"][pos] @ qv))
                    if diff > 1e-4:
                        failures.append(f"exemplar {eid} similarity off by {diff:.2e}")
                        break
            hit5 += any(s in acc for s in tops["a"])
            stable += tops["a"] == tops["u"]
            hit5_u += any(s in acc for s in tops["u"])
        conn.rollback()

    n = len(cases)
    print(f"G2.1 correct source in top 5: {hit5}/{n} = {100 * hit5 / n:.1f}%  (gate 85%, stage6 measured 92.3%)")
    print(f"     without diacritics:          {hit5_u}/{n} = {100 * hit5_u / n:.1f}%  (stage6: 93.6%)")
    print(f"G2.2 identical top 5 without diacritics: {stable}/{n} = {100 * stable / n:.1f}%  "
          f"(gate 90%; stage6 dense measured 10.3%)")
    print(f"per-query parity: {4 * 2 * n} searches compared, {len(failures)} differences")
    for f in failures[:20]:
        print("  ✗", f)
    if (round(100 * hit5 / n, 1), round(100 * hit5_u / n, 1), round(100 * stable / n, 1)) != (92.3, 93.6, 10.3):
        failures.append("scores differ from stage6 (92.3 / 93.6 / 10.3)")
    sys.exit(1 if failures else 0)


if __name__ == "__main__":
    main()
