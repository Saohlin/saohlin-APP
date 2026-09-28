// Unit tests for the parts of the pipeline the Python never had: the sentence
// gate, the prompt-leak check, crisis screening, memory in the prompt, and the
// persona-first rule (G1.2). No fixtures, no network.
//
//   deno test -A supabase/functions/_shared/pipeline/
import { deepStrictEqual, ok } from "node:assert";
import { continuationMessages, finalChecks, LeakIndex, SentenceGate, sentenceEnd, splitSentences } from "./gate.ts";
import { classifierMessages, keywordScreen, maxLevel, parseClassifier } from "./crisis.ts";
import { buildMessages, Library, memoryBlock, type Person, type Pools, type StaticKb } from "./prompt.ts";
import { enforceUnderstanding, plan, type Mode } from "./modes.ts";
import { maxLimits, retrievalQuery } from "./query.ts";

const eq = (a: unknown, b: unknown, m?: string) => deepStrictEqual(a, b, m);

const rules = {
  forbidden_ezo: [{ phrase: "vzorce / vnitřní vzorce", replacement: "opakující se reakce" }],
  broadcast_leakage: ["vítám vás", "napište mi do komentářů"],
  spoken_fillers: ["jako", "vlastně"].slice(0, 0),
};

Deno.test("sentence boundaries: Czech abbreviations and dates do not end a sentence", () => {
  eq(sentenceEnd("Např. tohle je jedna věta. A druhá"), "Např. tohle je jedna věta. ".length);
  eq(sentenceEnd("Stalo se to 12. září. Pak"), "Stalo se to 12. září. ".length);
  eq(sentenceEnd("Co tě na tom bolí?"), -1, "no trailing space yet: the model may still add ?!");
  eq(sentenceEnd("Co tě na tom bolí? "), "Co tě na tom bolí? ".length);
  eq(sentenceEnd("Opravdu?! Ano"), "Opravdu?! ".length);
  eq(sentenceEnd("„Nadechni se.“ Potom"), "„Nadechni se.“ ".length);
  eq(splitSentences("Evo, rozumím. Co se v tobě ozvalo, tj. co jsi cítila? Díky"),
    ["Evo, rozumím. ", "Co se v tobě ozvalo, tj. co jsi cítila? ", "Díky"]);
});

Deno.test("gate: good sentences are released one at a time, a hedged „zkus“ never is", () => {
  const g = new SentenceGate({ rules, mode: "VEDENI", gender: "f" });
  let r = g.push("Evo, to, co popisuješ, ukazuje jednu věc. Zkus se ");
  eq(r, { release: ["Evo, to, co popisuješ, ukazuje jednu věc. "], stop: false });
  r = g.push("nadechnout. A pak");
  eq(r.stop, true);
  eq(r.release, []);
  eq(g.failed[0].rule, "forbidden_word");
  eq(g.text, "Evo, to, co popisuješ, ukazuje jednu věc. ");
});

Deno.test("gate: descriptive „zkusila jsi“ passes (her 13 September clarification)", () => {
  const g = new SentenceGate({ rules, mode: "VEDENI", gender: "f" });
  const r = g.push("Zkusila jsi to a nefungovalo to. Co se stalo potom? ");
  eq(r.stop, false);
  eq(r.release.length, 2);
});

Deno.test("gate: PROZKOUMANI allows exactly one question", () => {
  const g = new SentenceGate({ rules, mode: "PROZKOUMANI", gender: null });
  eq(g.push("Co se v tobě ozvalo jako první? ").stop, false);
  eq(g.push("A co sis v tu chvíli říkala? ").stop, true);
  eq(g.failed[0].rule, "too_many_questions");
});

Deno.test("gate: validating opener, vykání, broadcast leakage and ezo phrases are stopped", () => {
  for (const [text, rule] of [
    ["To musí být opravdu těžké. ", "validating_opener"],
    ["Máte pravdu, že to bolí. ", "register"],
    ["Vítám vás u dalšího videa. ", "broadcast_leakage"],
    ["Tvoje vzorce se opakují. ", "forbidden_ezo"],
    ["Byl jsi na sebe přísný. ", "gender_agreement"],
  ]) {
    const g = new SentenceGate({ rules, mode: "VEDENI", gender: "f" });
    eq(g.push(text).stop, true, text);
    eq(g.failed[0].rule, rule, text);
  }
});

Deno.test("gate: flush checks a last sentence without punctuation", () => {
  const g = new SentenceGate({ rules, mode: "VEDENI", gender: null });
  eq(g.push("Tohle je první věta. A tohle druhá").release, ["Tohle je první věta. "]);
  eq(g.flush(), { release: ["A tohle druhá"], stop: false });
  eq(g.text, "Tohle je první věta. A tohle druhá");
});

Deno.test("prompt leak: 8 words from the persona are stopped, her identity sentence is allowed", () => {
  const persona = "Jsi CLAUDIA AI. Nikdy nepiš, že ti průvodce něco vzkazuje, ani že ti Stvořitel kartu poslal.";
  const identity = "Jsem CLAUDIA AI, tvůj spirituální průvodce, vytvořený Claudií Simon a jejím týmem.";
  const leak = new LeakIndex([persona, "Jsem CLAUDIA AI, tvůj spirituální průvodce, vytvořený Claudií Simon a jejím týmem."]);
  const g = new SentenceGate({ rules, mode: "VEDENI", gender: null, leak, allowedVerbatim: [identity] });
  eq(g.push(identity + " ").stop, false);
  eq(g.push("Nikdy nepiš, že ti průvodce něco vzkazuje, ani to. ").stop, true);
  eq(g.failed[0].rule, "prompt_leak");
});

Deno.test("final checks: length, missing question and vocative are whole-reply rules", () => {
  const f = finalChecks("Tohle je krátké.", rules, { mode: "PROZKOUMANI", budget: [20, 65], name: "Eva", vocativeForm: "Evo", gender: "f" });
  eq(f.map((x) => x.rule).sort(), ["no_question", "vocative"]);
});

Deno.test("continuation keeps the good part and asks only for the fix", () => {
  const m = continuationMessages([{ role: "user", content: "x" }], "Evo, dobře. ",
    [{ rule: "forbidden_word", found: "zkus (hedged guidance)", use_instead: "Podívej se…" }], { vocativeForm: "Evo", gender: "f" });
  eq(m.at(-2), { role: "assistant", content: "Evo, dobře. " });
  ok(m.at(-1)!.content.includes("Pokračuj přesně tam, kde končí"));
  ok(m.at(-1)!.content.includes("Vynech „zkus (hedged guidance)“"));
});

Deno.test("crisis: keyword screen is diacritics-insensitive and never lowered", () => {
  eq(keywordScreen("Už nechci žít."), "elevated");
  eq(keywordScreen("uz nechci zit"), "elevated");
  eq(keywordScreen("Rozešel se se mnou přítel."), "none");
  eq(keywordScreen("mám plán, jak to ukončit", ["mam\\s+plan"]), "elevated");
  eq(keywordScreen("cokoli", ["(nevalidni"]), "none", "a broken config pattern must not throw");
  eq(maxLevel("elevated", "low"), "elevated");
  eq(maxLevel("elevated", "acute"), "acute");
  eq(parseClassifier('{"level":"acute"}'), "acute");
  eq(parseClassifier("```json\n{\"level\": \"none\"}\n```"), "none");
  eq(parseClassifier("nonsense"), "low", "an unreadable answer is not treated as safe");
  ok(classifierMessages("x", ["a", "b", "c"])[1].content.startsWith("DŘÍVE: b"));
});

Deno.test("retrieval query: current message, previous user turn and what is still unknown", () => {
  eq(retrievalQuery("A proč?", "Rozešel se se mnou přítel.", "co ho drží"), "A proč?\nRozešel se se mnou přítel.\nco ho drží");
  eq(retrievalQuery("Ahoj", null, ""), "Ahoj");
  eq(maxLimits(), { knowledge: 6, video: 2, guide: 3, realclient: 1 });
});

// A small synthetic library, enough to assemble prompts without her KB.
const item = (id: string, text: string, extra: Record<string, unknown> = {}) =>
  ({ id, topic: id, text, wordCount: text.split(" ").length, meta: { source_file: `x/${id}.docx`, depth: "prakticka", ...extra } });
const kb: StaticKb = {
  styleCard: "# STYLOVÁ KARTA\nPiš krátce.",
  styles: [item("Safety boundaries", "Bezpečnost."), item("Claudia AI — Identity & Role", "Identita."), item("Other rule", "Pravidlo o vztazích.")],
  guidePrinciples: [{ ...item("p0", "Princip."), guideName: "STVOŘITEL" }],
  framework: [item("f0", "Rámec karty.")],
  guideMap: [{ ...item("g0", "Mapa."), guideName: "STVOŘITEL" }],
  styleRules: rules,
};
kb.styles[0].meta.source_file = "1/Safety boundaries.docx";
kb.styles[1].meta.source_file = "1/Claudia AI — Identity & Role.docx";
const pools: Pools = {
  knowledge: [item("k1", "Znalost jedna."), item("k2", "Znalost dvě.")],
  video: [item("v1", "Video.")], guide: [], realclient: [], pinned: [],
  exemplars: [{ id: "e1", bank: "feedback_r1", situation: "Situace", claudiaResponse: "Odpověď?", mode: "PROZKOUMANI", wordCount: 1, score: 0.5 }],
};

Deno.test("G1.2: the persona is the first system message on 200 synthetic turns", async () => {
  const lib = new Library(kb);
  const msgs = ["Rozešel se se mnou přítel.", "Co je posvátná pauza?", "Jsi robot?", "Vytáhla jsem si kartu.", "Nevím.", "Už nechci žít."];
  for (let i = 0; i < 200; i++) {
    const userMsg = msgs[i % msgs.length] + " " + i;
    const history = Array.from({ length: i % 5 }, (_, k) => ({ role: (k % 2 ? "assistant" : "user") as "user" | "assistant", content: `t${k}` }));
    const p = enforceUnderstanding(await plan(userMsg, history), history, userMsg);
    const person: Person = { name: i % 3 ? "Eva" : null, vocative: i % 3 ? "Evo" : null, gender: "f", notes: i % 2 ? [{ category: "work", key: "job", content: "Učitelka." }] : [] };
    const { messages } = buildMessages({ lib, userMsg, person, history, plan: p, pools });
    eq(messages[0].role, "system");
    ok(messages[0].content.startsWith("Jsi CLAUDIA AI. Odpovídáš výhradně česky.\n\n=== STYLOVÁ KARTA (jak píšeš) ===\n# STYLOVÁ KARTA"));
    eq(messages.at(-1), { role: "user", content: userMsg });
  }
});

Deno.test("memory: layers 1-4 appear as one fenced block, and not at all when nothing is known", () => {
  eq(memoryBlock({ name: "Eva", vocative: "Evo", gender: "f" }), "");
  const block = memoryBlock({
    name: "Eva", vocative: "Evo", gender: "f", zodiac: "leo",
    context: { work: "Učitelka", blocking: "Strach z odmítnutí" },
    notes: [{ category: "relationship", key: "partner", content: "Rozešla se s Tomášem." }],
    summary: "Mluvily o tom, že mu pořád píše.",
    recentConversations: [{ title: "Máma", summary: "Odpuštění mámě.", lastMessageAt: "2026-09-01T10:00:00Z" }],
  }, [{ content: "Uvědomila si, že se bojí samoty.", occurredAt: "2026-08-01T10:00:00Z" }]);
  ok(block.startsWith("=== O TOMTO ČLOVĚKU ==="));
  for (const s of ["oslovení: Evo", "Znamení: Lev", "Čemu se věnuje: Učitelka", "(vztahy) Rozešla se s Tomášem.",
    "Mluvily o tom", "1. 9. 2026, Máma: Odpuštění mámě.", "1. 8. 2026: Uvědomila si", "neřiď se tím"]) ok(block.includes(s), s);
});

Deno.test("memory sits between the persona and the exemplars; crisis block goes in the tail", async () => {
  const lib = new Library(kb);
  const person: Person = { name: "Eva", vocative: "Evo", gender: "f", notes: [{ category: "work", key: "job", content: "Učitelka." }] };
  const p = { ...(await plan("Už nechci žít.")), mode: "HRANICE" as Mode };
  const { messages } = buildMessages({
    lib, userMsg: "Už nechci žít.", person, history: [], plan: p, pools,
    crisis: { level: "acute", resources: [{ name: "Linka první psychické pomoci", phone: "116 123" }] },
  });
  eq(messages[1].role, "system");
  ok(messages[1].content.startsWith("=== O TOMTO ČLOVĚKU ==="));
  eq(messages[2], { role: "user", content: "Situace" });
  const tail = messages.at(-2)!.content;
  ok(tail.includes("=== BEZPEČÍ MÁ PŘEDNOST ===") && tail.includes("116 123"));
});
