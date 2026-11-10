// Hard checks on a reply before anyone sees it.
// Port of voice_checks_v2.extra_hard_checks / soft_flags and
// stage10_voice_score.score_reply. Every pattern comes from constants.json
// (exported from the Python) or, for her 46 ezo phrases, broadcast leakage and
// spoken fillers, from style_rules.json in kb.check_rules.
import C from "./constants.json" with { type: "json" };
import {
  count, countAll, escape, findAllGroup1, pyLen, pySlice, search, split, strip, unaccent, words,
} from "./pyre.ts";
import { vocative } from "./vocative.ts";

export interface Failure { rule: string; found: string; use_instead: string }
export interface StyleRules {
  forbidden_ezo: { phrase: string; replacement: string }[];
  broadcast_leakage: string[];
  spoken_fillers: string[];
  targets?: unknown;
}

const V = C.checks;
const S = C.score;
const EXEMPT_IN_KARTA = new Set<string>(V.CLICHES_EXEMPT_IN_KARTA);
const TY_STOP = new Set<string>(S.TY_STOP);
const VY_STOP = new Set<string>(S.VY_STOP);

function sentences(text: string): string[] {
  return split(V.SENT.pattern, strip(text)).filter((s) => strip(s));
}

function firstSentences(text: string, n = 2): string {
  return sentences(text).slice(0, n).join(" ");
}

export function extraHardChecks(text: string, mode?: string | null, budget?: [number, number] | null): Failure[] {
  const out: Failure[] = [];
  const flat = unaccent(text.toLowerCase());

  for (const w of V.FORBIDDEN_WORDS) {
    if (search(unaccent(w.pattern), flat) || search(w.pattern, text, { i: true })) {
      out.push({ rule: "forbidden_word", found: w.label, use_instead: w.use_instead });
    }
  }

  for (const [pat, label] of V.FORBIDDEN_CLICHES as [string, string][]) {
    if (mode === "KARTA" && EXEMPT_IN_KARTA.has(label)) continue;
    if (search(pat, text, { i: true }) || search(unaccent(pat), flat)) {
      out.push({
        rule: "cliche", found: label,
        use_instead: "rada musí vycházet z konkrétní situace uživatele; když ji neznáš, zeptej se",
      });
    }
  }

  const head = firstSentences(text);
  const headFlat = unaccent(head.toLowerCase());
  for (const [pat, label] of V.FORBIDDEN_OPENERS as [string, string][]) {
    if (search(pat, head, { i: true }) || search(unaccent(pat), headFlat)) {
      out.push({
        rule: "validating_opener", found: label,
        use_instead: "nezačínej tím, jak je to těžké. Krátce dej najevo, že rozumíš, a hned ukaž, co ta situace umožňuje změnit",
      });
      break;
    }
  }

  if (search("(posv[áa]tn|v[ěe]dom)\\w*\\s+pauz", text, { i: true })) {
    const m = search(
      "zeptej\\s+se\\s+sam[aá]\\s+sebe|zeptej\\s+se\\s+s[áa]m\\s+sebe|" +
        "(klidn[áa]|siln[áa])\\s+a\\s+(siln[áa]|klidn[áa])\\s+verze|" +
        "kdyby(ch|s)\\s+(byl[aa]?\\s+)?ve\\s+(sv[ée]|tv[ée])\\s+s[íi]le",
      text, { i: true },
    );
    if (m) {
      out.push({
        rule: "pause_protocol",
        found: `pauza obrácená do sebe: „${pySlice(m[0], 40)}“`,
        use_instead: "vedení v pauze nepřichází z vlastní hlavy; krok 4 se neptá sebe sama",
      });
    }
  }

  if (countAll(V.STEP_LIST.pattern, text, V.STEP_LIST) >= 4 && search(V.PAUSE_TOPIC.pattern, text, V.PAUSE_TOPIC)) {
    const m = search(V.SECULARISED.pattern, text, V.SECULARISED);
    if (m) {
      out.push({
        rule: "pause_protocol",
        found: `krok přepsaný na „${pySlice(m[0], 44)}“`,
        use_instead: "krok 4 zní „Zeptej se Stvořitele“ — součástí principu je vedení od Stvořitele a absolutní důvěra",
      });
    }
  }

  const nWords = words(text).length;
  const questions = count(text, "?");

  if (budget) {
    const [lo, hi] = budget;
    if (nWords > hi * 1.3) {
      out.push({
        rule: "too_long", found: `${nWords} slov, režim ${pyStr(mode)} má ${lo}–${hi}`,
        use_instead: `zkrať na ${lo}–${hi} slov; síla je v přesnosti, ne v délce`,
      });
    }
  }
  if ((mode === "VEDENI" || mode === "VYSVETLENI") && questions > 2) {
    out.push({
      rule: "too_many_questions", found: `${questions} otázky v režimu ${mode}`,
      use_instead: "jedna přesná otázka na konci, ne série",
    });
  }
  if (mode === "PROZKOUMANI" && questions > 1) {
    out.push({
      rule: "too_many_questions", found: `${questions} otázek`,
      use_instead: "v tomto režimu jedna jediná přesná otázka",
    });
  }
  if (mode === "PROZKOUMANI" && questions === 0) {
    out.push({
      rule: "no_question", found: "režim PROZKOUMÁNÍ bez otázky",
      use_instead: "zakonči jednou přesnou otázkou — v tomto režimu je otázka celý smysl odpovědi",
    });
  }

  const seen = new Set<string>();
  return out.filter((h) => {
    const key = h.rule + "\u0000" + h.found;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** Python's str(None) in the too_long message. */
function pyStr(v: unknown): string {
  return v === null || v === undefined ? "None" : String(v);
}

export function softFlags(text: string, mode?: string | null, budget?: [number, number] | null): string[] {
  const out: string[] = [];
  const nWords = words(text).length;
  if (mode !== "PROZKOUMANI" && count(text, "?") === 0) {
    out.push("odpověď neobsahuje žádnou otázku — u ní je otázkou 27,9 % vět");
  }
  if (budget) {
    const [lo, hi] = budget;
    if (nWords < lo * 0.7) {
      out.push(`kratší než rozpětí režimu (${nWords} slov, čekáno ${lo}–${hi}) — zkontroluj, jestli je odpověď úplná`);
    } else if (nWords > hi) {
      out.push(`nad rozpětím režimu (${nWords} slov, čekáno ${lo}–${hi})`);
    }
  }
  if (search(V.BLAME_OTHER.pattern, text, V.BLAME_OTHER) && !search(V.SELF_INQUIRY.pattern, text, V.SELF_INQUIRY)) {
    out.push("radí, co říct nebo udělat druhému člověku, a nikde se neptá, co situace ukazuje uživateli (Zuzana #11)");
  }
  const sents = sentences(text);
  if (sents.length >= 4 && !sents.some((s) => words(s).length < 6)) {
    out.push("žádná věta kratší než šest slov — chybí její rytmus");
  }
  return out;
}

export function countRegister(text: string): [number, number] {
  const low = text.toLowerCase();
  const ty = countAll(S.TY_PRON.pattern, low, S.TY_PRON) +
    findAllGroup1(S.TY_VERB.pattern, low, S.TY_VERB).filter((w) => !TY_STOP.has(w)).length;
  const vy = countAll(S.VY_PRON.pattern, low, S.VY_PRON) +
    findAllGroup1(S.VY_VERB.pattern, low, S.VY_VERB).filter((w) => !VY_STOP.has(w)).length;
  return [ty, vy];
}

export interface ScoreResult {
  passes_hard: boolean;
  hard_failures: Failure[];
  words: number;
  sentences: number;
  questions: number;
  ty_tokens: number;
  vy_tokens: number;
}

/**
 * stage10.score_reply, hard checks only (the pooled distribution statistics
 * are a batch measurement and are not needed per turn).
 * `vocativeForm` is the stored profile value; when absent, the rule-based
 * vocative of `name` is used, as in the Python.
 */
export function scoreReply(
  text: string, rules: StyleRules,
  opts: { name?: string | null; vocativeForm?: string | null; gender?: "f" | "m" | null; mode?: string | null; budget?: [number, number] | null } = {},
): ScoreResult {
  const t = strip(text);
  const flat = unaccent(t.toLowerCase());
  const sents = sentences(t);
  const hard: Failure[] = [];

  for (const pair of rules.forbidden_ezo) {
    const phrase = strip(pair.phrase.split(" / ")[0]).replace(/\?+$/u, "");
    if (pyLen(phrase) < 5) continue;
    if (flat.includes(unaccent(phrase.toLowerCase()))) {
      hard.push({ rule: "forbidden_ezo", found: phrase, use_instead: pair.replacement });
    }
  }

  for (const b of rules.broadcast_leakage) {
    if (search("(?<!\\w)" + escape(unaccent(b.toLowerCase())), flat)) {
      const dup = hard.some((h) => h.rule === "broadcast_leakage" &&
        unaccent(h.found.toLowerCase()) === unaccent(b.toLowerCase()));
      if (!dup) hard.push({ rule: "broadcast_leakage", found: b, use_instead: "personal address; there is no audience" });
    }
  }

  const [ty, vy] = countRegister(t);
  if (vy > 0) hard.push({ rule: "register", found: `${vy} vykani token(s)`, use_instead: "tykani throughout" });

  const name = opts.name;
  if (name) {
    const voc = opts.vocativeForm || vocative(name);
    if (!flat.includes(unaccent(voc.toLowerCase()))) {
      hard.push({ rule: "vocative", found: `'${voc}' not present`, use_instead: `address her as ${voc}, not ${name}` });
    } else if (voc.toLowerCase() !== name.toLowerCase() &&
      search(`\\b${escape(unaccent(name.toLowerCase()))}\\b`, flat)) {
      hard.push({ rule: "vocative", found: `nominative '${name}' used`, use_instead: `vocative '${voc}'` });
    }
  }

  const gender = opts.gender;
  if (gender === "f" || gender === "m") {
    const fem = countAll("\\b\\w+la\\s+jsi\\b|\\bjsi\\s+\\w+la\\b", t, { i: true });
    const masc = countAll("\\b\\w+[^l]l\\s+jsi\\b|\\bjsi\\s+\\w+[^l]l\\b", t, { i: true });
    if (gender === "f" && masc > fem) {
      hard.push({ rule: "gender_agreement", found: `${masc} masculine past-tense forms for a female user`, use_instead: "feminine -la forms" });
    }
    if (gender === "m" && fem > masc) {
      hard.push({ rule: "gender_agreement", found: `${fem} feminine past-tense forms for a male user`, use_instead: "masculine -l forms" });
    }
  }

  const fillers = rules.spoken_fillers.filter((f) =>
    search("(?<!\\w)" + escape(unaccent(f.toLowerCase())) + "(?!\\w)", flat));
  if (fillers.length) {
    hard.push({ rule: "spoken_filler", found: fillers.join(", "), use_instead: "written register; these belong to speech" });
  }

  hard.push(...extraHardChecks(t, opts.mode, opts.budget));

  return {
    passes_hard: hard.length === 0,
    hard_failures: hard,
    words: words(t).length,
    sentences: sents.length,
    questions: sents.filter((s) => s.trimEnd().endsWith("?")).length,
    ty_tokens: ty,
    vy_tokens: vy,
  };
}
