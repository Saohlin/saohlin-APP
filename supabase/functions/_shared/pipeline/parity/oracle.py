#!/usr/bin/env python3
"""Record what the Python pipeline does, so the TypeScript port can be held to it.

    python3 supabase/functions/_shared/pipeline/parity/oracle.py \\
        --base "/path/to/AI APP"
    deno test -A supabase/functions/_shared/pipeline/parity/

Writes parity/fixtures.json (git-ignored: it contains her knowledge base text).
Every expected value is produced by calling the Python functions themselves:

  routing     deterministic_mode and plan() on every message we have: the
              response_modes self-test, her 20 round 1 items, the demo suite,
              the round 2 openings and the 78 retrieval test questions
  gate        known_from_history / added_something / stalled /
              enforce_understanding on the 6 scripted conversations and on
              ~300 conversations stitched from those messages
  blocks      mode_block for every mode, explore turn, missing set and recent
  checks      extra_hard_checks, soft_flags and score_reply over her exemplars,
              the round 1 replies she rejected, the round 2 transcript and
              ~2,000 paragraphs of her knowledge base, in every mode
  vocative    every name in the suites plus a list of common Czech names
  bm25        rule, principle, framework and guide-map searches
  prompts     build_messages, byte for byte, for 78 questions x several modes,
              with and without history, from the same retrieved pools
"""
import argparse
import json
import os
import random
import sys


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", required=True)
    args = ap.parse_args()
    os.environ["SAOHLIN_BASE"] = args.base
    sys.path.insert(0, os.path.join(args.base, "scripts"))
    import numpy as np
    import response_modes as rm
    import stage8_chat as s8
    import stage10_voice_score as s10
    import verify_round1_feedback as vr1
    import voice_checks_v2 as vc

    corpus = os.path.join(args.base, "corpus")
    rnd = random.Random(20260929)
    out = {}

    # ------------------------------------------------------------ messages
    msgs = []
    msgs += [q for q, _ in [
        ("Rozešel se se mnou přítel a pořád čekám, jestli se mi ozve.", ""),
        ("Co je posvátná pauza a jak ji mám použít, když mám chuť mu napsat?", ""),
        ("Minule jsi mi řekla, ať dělám tu pauzu. Zkoušel jsem to a nefunguje mi to.", ""),
        ("Jsi opravdu Claudia, nebo jsi jen robot, který se za ni vydává?", ""),
        ("Odpovídáš mi ty, nebo ChatGPT? Buď na mě upřímná.", ""),
        ("Máš nějaký tip, jaké akcie teď koupit? Potřebuju rychle peníze.", ""),
        ("Mám bolesti hlavy už dva týdny. Myslíš, že je to energetické?", ""),
        ("Co je Nádoba a Světlo? Slyšel jsem to od tebe.", ""),
        ("Vytáhla jsem si kartu Věž a mám z ní strach. Co to znamená?", ""),
        ("Můžeš mi říct, kdy umřu? Bojím se toho a chci to vědět.", ""),
        ("Že už nechci žít.", ""),
    ]]
    msgs += [it["q"] for it in vr1.ITEMS]
    msgs += [q for _t, _n, q in s8.SUITE_TAGGED]
    msgs += [c["opening"] for c in s8.CONVERSATIONS] + [c.get("fallback", "") for c in s8.CONVERSATIONS if c.get("fallback")]
    tests = json.load(open(os.path.join(corpus, "retrieval_testset_cz.json"), encoding="utf-8"))["cases"]
    msgs += [c["q"] for c in tests]
    msgs = list(dict.fromkeys(m for m in msgs if m))
    out["routing"] = [{"msg": m, "det": rm.deterministic_mode(m), "plan": rm.plan(m)} for m in msgs]

    # the round 1 feedback items: routing and "caught"
    r1 = []
    for it in vr1.ITEMS:
        got = rm.plan(it["q"])["mode"]
        fails = vc.extra_hard_checks(it["round1"], mode=got, budget=rm.MODES[got]["budget"])
        r1.append({"n": it["n"], "q": it["q"], "want": it["mode"], "got": got, "round1": it["round1"],
                   "failures": fails})
    out["round1"] = r1

    # ------------------------------------------------------------ gate
    def conv(pairs):
        hist = [{"role": "user" if w == "u" else "assistant", "content": t} for w, t in pairs[:-1]]
        return hist, pairs[-1][1]

    scripted = [
        [("u", "Rozešel se se mnou přítel."), ("a", "Co se v tobě ozvalo jako první?"),
         ("u", "Prázdno. Napsala jsem mu pak třikrát.")],
        [("u", "Rozešel se se mnou přítel."), ("a", "Co se v tobě ozvalo?"), ("u", "Prázdno. Napsala jsem mu třikrát."),
         ("a", "Co sis v tu chvíli říkala?"), ("u", "Že jsem otravná a že mě nechá jako ostatní.")],
        [("u", "Mám pocit, že nejsem dost dobrý v práci."), ("a", "Co se v tobě ozvalo?"), ("u", "Nevím."),
         ("a", "Co sis v tu chvíli říkal?"), ("u", "Fakt nevím, no.")],
        [("u", "Rozešel se se mnou přítel. Napsala jsem mu třikrát a pak jsem to smazala. Dělám to pořád dokola, "
               "v každém vztahu. Bojím se, že nejsem dost dobrá.")],
        [("u", "Je mi smutno a nevím proč.")],
        [("u", "Rozešel se se mnou přítel."), ("a", "Co se v tobě ozvalo?"), ("u", "Že už nechci žít.")],
    ]
    replies = ["Co se v tobě ozvalo jako první?", "Co sis v tu chvíli říkala?", "Kdy se ti to stalo poprvé?",
               "Přijde mi, že čekáš na jeho svolení. Co by se stalo, kdybys přestala?"]
    for _ in range(300):
        n = rnd.randint(1, 4)
        pairs = []
        for k in range(n):
            pairs.append(("u", rnd.choice(msgs + ["Nevím.", "Fakt nevím, no.", "Asi jo.", "Pořád to samé."])))
            if k < n - 1:
                pairs.append(("a", rnd.choice(replies)))
        scripted.append(pairs)
    gate = []
    for pairs in scripted:
        hist, msg = conv(pairs)
        p = rm.plan(msg, hist)
        gate.append({"history": hist, "msg": msg, "plan": p,
                     "known": sorted(rm.known_from_history(hist, msg)),
                     "added": rm.added_something(hist, msg), "stalled": rm.stalled(hist, msg),
                     "enforced": rm.enforce_understanding(p, hist, msg)})
    out["gate"] = gate

    # planner replies: parsing, including the turn-one override and garbage
    planner = []
    for raw, turn in [
        ('{"mode": "VEDENI", "vim": ["situace", "chovani"], "chybi": "proč", "otazka": "Co tě drží?"}', 1),
        ('{"mode": "VEDENI", "vim": ["situace", "chovani"], "chybi": "proč", "otazka": "Co tě drží?"}', 3),
        ('```json\n{"mode": "prozkoumani", "vim": "pod_tim", "chybi": "x", "otazka": "y"}\n```', 2),
        ('{"mode": "KARTA"}', 2), ("not json", 2), ("[1, 2]", 3), ('{"mode": "VEDENI", "vim": ["POD_TIM ", "nic"]}', 4),
    ]:
        seen = {}

        def fake(m, _model, raw=raw, seen=seen):
            seen["messages"] = m
            return raw, {}
        hist = [{"role": "user", "content": f"zpráva {i}"} if i % 2 == 0 else
                {"role": "assistant", "content": f"odpověď {i}"} for i in range(2 * (turn - 1) + 6)]
        planner.append({"raw": raw, "turn": turn, "history": hist,
                        "plan": rm.plan("Tohle je zpráva bez pravidla.", hist, call_fn=fake),
                        "messages": seen.get("messages")})
    out["planner"] = planner

    # ------------------------------------------------------------ mode blocks
    blocks = []
    for mode in rm.MODES:
        for et in (1, 2, 3):
            for miss in ([], ["pod_tim"], ["situace", "chovani", "opakovani", "pod_tim"]):
                for extra in ({}, {"chybi": "co ho drží", "otazka": "Co se v tobě ozvalo?"}):
                    for recent in (None, ["Terezo, to, co popisuješ", "Rozumím tvojí situaci. To", "a", "b", "c", "d"]):
                        p = {"mode": mode, "explore_turn": et, "chybi_ctyri": miss, **extra}
                        blocks.append({"plan": p, "recent": recent, "block": rm.mode_block(p, recent=recent),
                                       "budget": list(rm.budget(p))})
    out["blocks"] = blocks

    # ------------------------------------------------------------ checks
    def jl(name):
        with open(os.path.join(corpus, name), encoding="utf-8") as f:
            return [json.loads(x) for x in f if x.strip()]

    texts = []
    for f in ("kb_exemplars.jsonl", "kb_exemplars_round1_feedback.jsonl", "kb_realclient_exemplars.jsonl"):
        for e in jl(f):
            texts += [e["claudia_response"], e["situation"]]
    texts += [it["round1"] for it in vr1.ITEMS]
    texts += [s10.GENERIC, s10.BROADCASTY]
    try:
        tr = json.load(open(os.path.join(corpus, "round2_transcript.json"), encoding="utf-8"))

        def walk(o):
            if isinstance(o, str) and len(o) > 20:
                texts.append(o)
            elif isinstance(o, dict):
                for v in o.values():
                    walk(v)
            elif isinstance(o, list):
                for v in o:
                    walk(v)
        walk(tr)
    except OSError:
        pass
    paras = []
    for f in ("kb_knowledge_chunks.jsonl", "kb_guide_chunks.jsonl", "kb_realclient_chunks.jsonl",
              "kb_guide_rules.jsonl", "kb_phase2_rules.jsonl", "kb_style_sources.jsonl"):
        for c in jl(f):
            paras += [p for p in c["text"].split("\n") if len(p.split()) >= 4]
    vids = jl("kb_video_chunks.jsonl")
    for c in rnd.sample(vids, 150):
        paras.append(c["text"][:1500])
    rnd.shuffle(paras)
    texts += paras[:2000]
    texts = list(dict.fromkeys(texts))
    rules = s10.load_rules()
    names = [None, "Tereza", "Petr", "Jiří", "Daniel", "Šárka", "Vojtěch", "Marek", "Anna"]
    modes = [None] + list(rm.MODES)
    checks = []
    for i, t in enumerate(texts):
        mode = modes[i % len(modes)]
        bud = list(rm.MODES[mode]["budget"]) if mode else None
        name = names[i % len(names)]
        gender = s8.GENDER_OF.get(name) if name else None
        checks.append({
            "text": t, "mode": mode, "budget": bud, "name": name, "gender": gender,
            "extra": vc.extra_hard_checks(t, mode=mode, budget=tuple(bud) if bud else None),
            "soft": vc.soft_flags(t, mode=mode, budget=tuple(bud) if bud else None),
            "score": {k: v for k, v in s10.score_reply(t, rules, name=name, gender=gender, mode=mode,
                                                        budget=tuple(bud) if bud else None).items()
                      if k in ("passes_hard", "hard_failures", "words", "sentences", "questions",
                               "ty_tokens", "vy_tokens")},
        })
    out["checks"] = checks
    out["style_rules"] = rules

    # ------------------------------------------------------------ vocative
    extra_names = ["Jan", "Petra", "Lukáš", "Jakub", "Tomáš", "Kristýna", "Veronika", "Michaela", "Adéla", "Matěj",
                   "Ondřej", "Radek", "Zdeněk", "Luboš", "Vít", "Oldřich", "Hugo", "Otto", "Marie", "Lucie",
                   "Jiří", "Daniel", "Marcel", "Gabriel", "Pavel", "Karel", "Havel", "Emil", "Aleš", "Ivo",
                   "Dominik", "Vojtěch", "Bohdan", "Alex", "Nikola", "Denis", "René", "Jindřich", "Oleg", "Ruth",
                   "Zoe", "Eliška", "Anežka", "Josef", "Kamil", "Mirek", "Honza", "Míša", "Saša", "Jiří  "]
    out["vocative"] = [{"name": n, "voc": s8.vocative(n)} for n in dict.fromkeys(list(s8.GENDER_OF) + extra_names)]

    # ------------------------------------------------------------ retrieval + prompts
    r = s8.Retriever()
    z = np.load(os.path.join(corpus, "query_embeddings_cache.npz"), allow_pickle=True)
    qcache = {str(k): v for k, v in zip(z["keys"], z["vectors"])}

    def item(c):
        return {"id": c["id"], "topic": c.get("topic"), "guideName": c.get("guide_name"), "text": c["text"],
                "wordCount": c.get("word_count"),
                "meta": {"source_file": c.get("source_file"), "depth": c.get("depth"), "order": 0}}

    out["static"] = {
        "styleCard": open(s8.PERSONA, encoding="utf-8").read(),
        "styles": [item(s) for s in r.styles],
        "guidePrinciples": [item(s) for s in r.guide_rules],
        "framework": [item(s) for s in r.phase2_rules],
        "guideMap": [item(s) for s in r.guide_map],
    }

    bm = []
    for c in tests[:40]:
        q = c["q"]
        bm.append({"q": q,
                   "rules": [x["id"] for x in r.search_rules(q, k=2)],
                   "principles": [x["id"] for x in r.search_guide_rules(q, k=1)],
                   "framework": [x["id"] for x in r.search_phase2_rules(q, k=1)],
                   "gmap": [x["id"] for x in r.search_guide_map(q, None, k=1)]})
    out["bm25"] = bm

    pairs_all = [e for e in r.exemplars if e["pair_type"] == "turn_pair" and not e.get("_screened")]
    pos = {i: n for n, i in enumerate(r.dense_e["ids"])}
    prompts = []
    forced = [None, "PAUZA", "KARTA", "HRANICE", "IDENTITA", "VYSVETLENI", "VEDENI"]
    for k, c in enumerate(tests):
        q = c["q"]
        qv = qcache[q].astype(np.float32)
        qv = qv / max(np.linalg.norm(qv), 1e-9)
        for variant in range(2):
            hist = [] if variant == 0 else [
                {"role": "user", "content": tests[(k + 1) % len(tests)]["q"]},
                {"role": "assistant", "content": "Co se v tobě v tu chvíli ozvalo jako první?"}]
            name = ["Tereza", "Petr", "Jiří", "Šárka", None][k % 5]
            p = rm.enforce_understanding(rm.plan(q, hist), hist, q)
            fm = forced[(k + variant) % len(forced)]
            if fm:
                p = dict(p, mode=fm)
            recent = ["Terezo, to, co popisuješ, je", "Rozumím tvojí situaci. To, čím"] if variant else None
            pools = {
                "knowledge": [item(x) for x in r.search_knowledge(q, qv, k=6)],
                "video": [item(x) for x in r.search_video(q, qv, k=2)],
                "guide": [item(x) for x in r.search_guides(q, qv, k=3)],
                "realclient": [item(x) for x in r.search_clients(q, qv, k=1)],
                "pinned": [item(x) for x in r.chunks if "PROTOKOL.pdf" in x["source_file"]],
                "exemplars": [{"id": e["id"], "bank": e.get("bank"), "situation": e["situation"],
                               "claudiaResponse": e["claudia_response"], "mode": e.get("mode"),
                               "subtype": e.get("subtype"), "wordCount": e.get("word_count", 0),
                               "opensWithGreeting": bool(e.get("opens_with_greeting")),
                               "score": float(r.dense_e["V"][pos[e["id"]]] @ qv)} for e in pairs_all],
            }
            messages, know, rules_used, videos = s8.build_messages(
                r, q, name, qv, history=hist, plan_result=p, recent=recent)
            prompts.append({"q": q, "name": name, "vocative": s8.vocative(name) if name else None,
                            "gender": s8.GENDER_OF.get(name) if name else None, "history": hist, "plan": p,
                            "recent": recent, "pools": pools, "messages": messages,
                            "exemplars": [e["id"] for e in r.last_exemplars],
                            "knowledge": [x["id"] for x in know]})
    out["prompts"] = prompts

    path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "fixtures.json")
    with open(path, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False)
    print(f"wrote {path}: {len(out['routing'])} routing, {len(out['gate'])} gate, {len(out['blocks'])} blocks, "
          f"{len(out['checks'])} check texts, {len(out['vocative'])} names, {len(out['prompts'])} prompts")


if __name__ == "__main__":
    main()
