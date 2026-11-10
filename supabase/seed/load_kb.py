#!/usr/bin/env python3
"""Load Claudia's knowledge base into the `kb` schema, without re-embedding.

Reads the corpus the Python pipeline already built and embedded (the jsonl
files and the .npz vectors in `AI APP/corpus/`) and writes it to Postgres. No
OpenAI call is made, so loading costs no credit. Vectors are normalised to unit
length exactly as stage8_chat.load_npz does, so cosine order matches.

    pip install psycopg[binary] numpy
    DATABASE_URL=postgresql://... python supabase/seed/load_kb.py \\
        --base "/path/to/AI APP"

--base is the folder holding corpus/, persona/ and scripts/. With scripts/
present, exemplars are screened with voice_checks_v2 as the pipeline does.
The load is one transaction and idempotent: kb rows from these sources are
replaced, anything added later through the admin panel is left alone.

Decisions applied on load (SUPABASE_IMPLEMENTATION.md 16.3):
  - the 207 one-to-one reading passages load with personal_reading = true and
    stay out of retrieval while retrieval.exclude_personal_readings is true;
  - Phase 02 exemplars load with approved_by_claudia = false until she
    approves them (the approval list is still unsent).
"""
import argparse
import json
import os
import sys
import unicodedata

import numpy as np

IDENTITY_SENTENCE = ("Jsem CLAUDIA AI, tvůj spirituální průvodce, vytvořený Claudií Simon a jejím týmem. "
                     "Jsem tady, abych tě podpořila na tvé životní cestě. S čím dneska přicházíš?")

# Sent on every turn (stage8_chat.ALWAYS_RULES). Safety first, then identity.
ALWAYS_RULES = [
    "Safety boundaries.docx",
    "Safety & Spiritual Boundaries.docx",
    "Claudia AI — Harmful Behavior Boundaries.docx",
    "18+ user policy.docx",
    "Claudia AI — Identity & Role.docx",
    "  Claudia AI — First  Contact & Identity Rules.docx",
]

# collection name in kb.chunks -> (jsonl, npz or None)
COLLECTIONS = {
    "knowledge":       ("kb_knowledge_chunks.jsonl", "kb_embeddings.npz"),
    "video":           ("kb_video_chunks.jsonl", "kb_video_embeddings.npz"),
    "guide":           ("kb_guide_chunks.jsonl", "kb_guide_embeddings.npz"),
    "realclient":      ("kb_realclient_chunks.jsonl", "kb_realclient_embeddings.npz"),
    "guide_principle": ("kb_guide_rules.jsonl", None),
    "framework":       ("kb_phase2_rules.jsonl", None),
    "style_source":    ("kb_style_sources.jsonl", None),
    "guide_map":       ("kb_guide_map_chunks.jsonl", None),
}

EXEMPLAR_BANKS = [
    ("phase01", "kb_exemplars.jsonl", True),
    ("feedback_r1", "kb_exemplars_round1_feedback.jsonl", True),
    ("realclient_p2", "kb_realclient_exemplars.jsonl", False),
]
EXEMPLAR_EXCLUDING_RULES = ("forbidden_word", "cliche", "validating_opener")

PERSONA_FILE = "claudia_style_card_v2.md"
PERSONA_VERSION = "style_card_v2+2026-09-13"
CHECK_RULES_VERSION = "style_rules+voice_checks_v2+2026-09-13"

TOP_FIELDS = {"id", "text", "topic", "guide_name", "word_count", "chunk_index", "personal_reading"}


def nfc(s):
    return unicodedata.normalize("NFC", s) if isinstance(s, str) else s


def truthy(v):
    return v is True or (isinstance(v, str) and v.strip().lower() == "true")


def load_jsonl(path):
    with open(path, encoding="utf-8") as f:
        return [json.loads(line) for line in f if line.strip()]


def load_npz(path):
    z = np.load(path, allow_pickle=True)
    v = z["vectors"].astype(np.float32)
    v /= np.clip(np.linalg.norm(v, axis=1, keepdims=True), 1e-9, None)
    if int(z["dims"]) != 1024 or str(z["model"]) != "text-embedding-3-large":
        sys.exit(f"{path}: expected text-embedding-3-large at 1024 dims, got {z['model']} {z['dims']}")
    return {str(i): v[n] for n, i in enumerate(z["ids"])}


def vec_literal(v):
    return "[" + ",".join(f"{x:.7g}" for x in v.tolist()) + "]"


def as_int(v, default=None):
    try:
        return int(v)
    except (TypeError, ValueError):
        return default


def screen(exemplar, checks):
    if checks is None:
        return None
    fails = [f for f in checks(exemplar.get("claudia_response", "")) if f["rule"] in EXEMPLAR_EXCLUDING_RULES]
    # zkus in her own text is allowed since 13 September (DECISIONS_LOG 1b).
    fails = [f for f in fails if not (f["rule"] == "forbidden_word" and str(f["found"]).startswith("zkus"))]
    return "; ".join(f"{f['rule']}: {f['found']}" for f in fails) or None


def build(base):
    corpus = os.path.join(base, "corpus")
    checks = None
    scripts = os.path.join(base, "scripts")
    if os.path.isdir(scripts):
        sys.path.insert(0, scripts)
        try:
            from voice_checks_v2 import extra_hard_checks as checks  # noqa: N813
        except ImportError:
            checks = None

    docs, chunks = {}, []
    always = {nfc(a) for a in ALWAYS_RULES}
    for coll, (jsonl, npz) in COLLECTIONS.items():
        rows = load_jsonl(os.path.join(corpus, jsonl))
        vecs = load_npz(os.path.join(corpus, npz)) if npz else {}
        missing = [r["id"] for r in rows if npz and r["id"] not in vecs]
        if missing:
            sys.exit(f"{coll}: {len(missing)} passages have no vector (first: {missing[0]}). Run stage7_embed first.")
        for n, r in enumerate(rows):
            src = nfc(r.get("source_file") or r["id"])
            personal = truthy(r.get("personal_reading"))
            d = docs.setdefault((coll, src), {"collection": coll, "title": nfc(r.get("topic") or src), "personal": False})
            d["personal"] = d["personal"] or personal
            meta = {k: nfc(v) for k, v in r.items() if k not in TOP_FIELDS}
            meta["order"] = f"{n:05d}"
            meta["source_file"] = src
            if coll == "style_source":
                meta["always"] = nfc(os.path.basename(src)) in always
            chunks.append({
                "id": nfc(r["id"]), "source_file": src, "collection": coll,
                "chunk_index": as_int(r.get("chunk_index"), 0),
                "guide_name": nfc(r.get("guide_name")) or None,
                "topic": nfc(r.get("topic")), "text": nfc(r["text"]),
                "word_count": as_int(r.get("word_count"), len(r["text"].split())),
                "embedding": vec_literal(vecs[r["id"]]) if npz else None,
                "meta": meta, "personal_reading": personal,
            })

    ex_vecs = load_npz(os.path.join(corpus, "kb_exemplar_embeddings.npz"))
    exemplars = []
    for bank, jsonl, approved in EXEMPLAR_BANKS:
        for n, r in enumerate(load_jsonl(os.path.join(corpus, jsonl))):
            resp = nfc(r["claudia_response"])
            meta = {k: nfc(v) for k, v in r.items()
                    if k not in {"id", "situation", "claudia_response", "mode", "subtype", "pair_type",
                                 "verbatim", "opens_with_greeting", "word_count"}}
            meta["order"] = f"{n:05d}"
            exemplars.append({
                "id": nfc(r["id"]), "bank": bank, "situation": nfc(r["situation"]), "claudia_response": resp,
                "mode": r.get("mode") or None, "subtype": r.get("subtype") or None,
                "pair_type": r.get("pair_type") or "turn_pair",
                "verbatim": r.get("verbatim") is None or truthy(r.get("verbatim")),
                "opens_with_greeting": truthy(r.get("opens_with_greeting")),
                "word_count": as_int(r.get("word_count")) or len(resp.split()),
                "embedding": vec_literal(ex_vecs[r["id"]]) if r["id"] in ex_vecs else None,
                "approved_by_claudia": approved,
                "excluded_reason": screen(r, checks),
                "meta": meta,
            })

    with open(os.path.join(base, "persona", PERSONA_FILE), encoding="utf-8") as f:
        style_card = f.read()
    with open(os.path.join(corpus, "style_rules.json"), encoding="utf-8") as f:
        style_rules = json.load(f)
    return docs, chunks, exemplars, style_card, style_rules, checks is not None


def load(conn, docs, chunks, exemplars, style_card, style_rules):
    with conn.cursor() as cur:
        cur.execute("delete from kb.chunks where collection = any(%s) and status = 'approved'",
                    (list(COLLECTIONS),))
        for (_coll, src), d in docs.items():
            cur.execute(
                """insert into kb.documents (collection, source_file, title, personal_reading, status, approved_at)
                   values (%s, %s, %s, %s, 'approved', now())
                   on conflict (collection, source_file) do update set
                     title = excluded.title, personal_reading = excluded.personal_reading
                   returning id""",
                (d["collection"], src, d["title"], d["personal"]))
            d["id"] = cur.fetchone()[0]
        with cur.copy("""copy kb.chunks (id, document_id, collection, chunk_index, guide_name, topic, text,
                                         embedding, word_count, meta, personal_reading) from stdin""") as cp:
            for c in chunks:
                cp.write_row((c["id"], docs[(c["collection"], c["source_file"])]["id"], c["collection"], c["chunk_index"],
                              c["guide_name"], c["topic"], c["text"], c["embedding"], c["word_count"],
                              json.dumps(c["meta"], ensure_ascii=False), c["personal_reading"]))

        cur.execute("delete from kb.exemplars where bank = any(%s)", ([b for b, _, _ in EXEMPLAR_BANKS],))
        with cur.copy("""copy kb.exemplars (id, bank, situation, claudia_response, mode, subtype, pair_type,
                                            verbatim, opens_with_greeting, word_count, embedding,
                                            approved_by_claudia, excluded_reason, meta) from stdin""") as cp:
            for e in exemplars:
                cp.write_row((e["id"], e["bank"], e["situation"], e["claudia_response"], e["mode"], e["subtype"],
                              e["pair_type"], e["verbatim"], e["opens_with_greeting"], e["word_count"],
                              e["embedding"], e["approved_by_claudia"], e["excluded_reason"],
                              json.dumps(e["meta"], ensure_ascii=False)))

        cur.execute("update kb.persona_versions set active = false where active")
        cur.execute("""insert into kb.persona_versions (version, style_card, identity_sentence, active)
                       values (%s, %s, %s, true)
                       on conflict (version) do update set style_card = excluded.style_card,
                         identity_sentence = excluded.identity_sentence, active = true""",
                    (PERSONA_VERSION, style_card, IDENTITY_SENTENCE))
        cur.execute("update kb.check_rules set active = false where active")
        cur.execute("""insert into kb.check_rules (version, rules, active) values (%s, %s, true)
                       on conflict (version) do update set rules = excluded.rules, active = true""",
                    (CHECK_RULES_VERSION, json.dumps({"style_rules": style_rules}, ensure_ascii=False)))

        cur.execute("""select collection, count(*), count(*) filter (where personal_reading),
                              count(*) filter (where embedding is not null)
                       from kb.chunks group by collection order by collection""")
        report = cur.fetchall()
        cur.execute("""select bank, count(*), count(*) filter (where approved_by_claudia),
                              count(*) filter (where excluded_reason is not null)
                       from kb.exemplars group by bank order by bank""")
        report_ex = cur.fetchall()
    return report, report_ex


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--base", required=True, help="folder with corpus/, persona/ and scripts/")
    ap.add_argument("--dsn", default=os.environ.get("DATABASE_URL"), help="Postgres connection string")
    ap.add_argument("--dry-run", action="store_true", help="read and validate, write nothing")
    args = ap.parse_args()

    docs, chunks, exemplars, style_card, style_rules, screened = build(args.base)
    print(f"read {len(chunks)} passages in {len(docs)} documents, {len(exemplars)} exemplars"
          f"{'' if screened else ' (scripts/ not found: exemplars NOT screened)'}")
    if args.dry_run:
        return
    if not args.dsn:
        sys.exit("set DATABASE_URL or pass --dsn")

    import psycopg
    with psycopg.connect(args.dsn) as conn:
        report, report_ex = load(conn, docs, chunks, exemplars, style_card, style_rules)
    print(f"{'collection':<16} {'rows':>6} {'personal':>9} {'vectors':>8}")
    for coll, n, pers, vec in report:
        print(f"{coll:<16} {n:>6} {pers:>9} {vec:>8}")
    print(f"{'exemplar bank':<16} {'rows':>6} {'approved':>9} {'screened':>8}")
    for bank, n, appr, scr in report_ex:
        print(f"{bank:<16} {n:>6} {appr:>9} {scr:>8}")


if __name__ == "__main__":
    main()
