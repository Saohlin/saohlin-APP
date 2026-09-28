// Sentence-gated release (Chat Module Spec, Server pipeline).
//
// Tokens from the model are buffered to a sentence boundary, the sentence is
// checked, and only then released to the app. A sentence that breaks one of
// her rules is never shown: generation stops and one corrective continuation
// is requested from the last good sentence. If that fails too, the reply ends
// at the last good sentence, which is always a complete thought.
//
// Which checks can run per sentence: the ones about wording (banned words and
// phrases, clichés, the validating opener, the pause protocol, register,
// broadcast leakage, fillers, prompt leak) and the question count in
// PROZKOUMANI. The ones about the whole reply (length, a missing question, a
// missing vocative) run at the end and are logged for review, because by then
// the text is on screen.
import { type Failure, scoreReply, type StyleRules } from "./checks.ts";
import { strip, unaccent, words } from "./pyre.ts";

// Abbreviations that end in a full stop but do not end a sentence.
const ABBREV = new Set([
  "např", "tzn", "tj", "tzv", "atd", "apod", "resp", "cca", "str", "př", "mj", "aj", "popř", "příp", "zejm",
  "dr", "mgr", "ing", "bc", "ph", "ph.d", "doc", "prof", "sv", "st", "č", "s", "r", "o", "min", "hod", "tel",
]);

/** Index just past the first complete sentence in `buf`, or -1 if none yet. */
export function sentenceEnd(buf: string): number {
  const re = /[.!?…]+["“”»)\]]*(\s+|$)/gu;
  for (const m of buf.matchAll(re)) {
    const end = (m.index ?? 0) + m[0].length;
    if (end === buf.length && !/\s$/u.test(m[0])) return -1; // might continue ("...", "?!")
    const before = buf.slice(0, m.index);
    const last = before.split(/\s+/u).pop() ?? "";
    const word = last.toLowerCase().replace(/^[„"(«]+/u, "");
    if (m[0].startsWith(".") && (ABBREV.has(word) || /^\d+$/u.test(word))) continue; // "např.", "12. září"
    return end;
  }
  return -1;
}

/** Split finished text into sentences with the same rules (for replays and tests). */
export function splitSentences(text: string): string[] {
  const out: string[] = [];
  let rest = text;
  for (;;) {
    const e = sentenceEnd(rest + (rest.endsWith(" ") ? "" : " "));
    if (e === -1 || e >= rest.length) break;
    out.push(rest.slice(0, e));
    rest = rest.slice(e);
  }
  if (strip(rest)) out.push(rest);
  return out;
}

// Rules that can be judged on a prefix of the reply.
const SENTENCE_RULES = new Set([
  "forbidden_ezo", "broadcast_leakage", "register", "spoken_filler", "forbidden_word", "cliche",
  "validating_opener", "pause_protocol", "prompt_leak", "gender_agreement",
]);

const key = (f: Failure) => f.rule + "\u0000" + f.found;

/** Rolling 8-word shingles of the persona and always-on documents. */
export class LeakIndex {
  private shingles = new Set<string>();
  constructor(sources: string[], readonly n = 8) {
    for (const s of sources) {
      const w = norm(s);
      for (let i = 0; i + n <= w.length; i++) this.shingles.add(w.slice(i, i + n).join(" "));
    }
  }
  /** The first 8-word run of `text` that appears in a source, or null. */
  find(text: string): string | null {
    const w = norm(text);
    for (let i = 0; i + this.n <= w.length; i++) {
      const s = w.slice(i, i + this.n).join(" ");
      if (this.shingles.has(s)) return s;
    }
    return null;
  }
}
function norm(s: string): string[] {
  return unaccent(s.toLowerCase()).split(/[^\p{L}\p{N}]+/u).filter(Boolean);
}

export interface GateContext {
  rules: StyleRules;
  mode: string;
  gender: "f" | "m" | null;
  leak?: LeakIndex | null;
  /** her own sentences that are allowed verbatim (the identity sentence) */
  allowedVerbatim?: string[];
}

export class SentenceGate {
  private released = "";
  private buffer = "";
  private known = new Set<string>();
  private questions = 0;
  failed: Failure[] = [];

  constructor(private ctx: GateContext) {}

  get text(): string {
    return this.released;
  }

  /**
   * Feed model output. Returns the sentences that passed, in order, and
   * whether a sentence failed (in which case generation must stop).
   */
  push(delta: string): { release: string[]; stop: boolean } {
    this.buffer += delta;
    const release: string[] = [];
    for (;;) {
      const e = sentenceEnd(this.buffer);
      if (e === -1) break;
      const s = this.buffer.slice(0, e);
      const verdict = this.check(s);
      if (verdict.length) {
        this.failed = verdict;
        this.buffer = "";
        return { release, stop: true };
      }
      this.accept(s);
      release.push(s);
      this.buffer = this.buffer.slice(e);
    }
    return { release, stop: false };
  }

  /** End of stream: check and release whatever is left (a last sentence without punctuation). */
  flush(): { release: string[]; stop: boolean } {
    const s = this.buffer;
    this.buffer = "";
    if (!strip(s)) return { release: [], stop: false };
    const verdict = this.check(s);
    if (verdict.length) {
      this.failed = verdict;
      return { release: [], stop: true };
    }
    this.accept(s);
    return { release: [s], stop: false };
  }

  private accept(s: string) {
    this.released += s;
    for (const f of this.prefixFailures(this.released)) this.known.add(key(f));
    this.questions += (s.match(/\?/gu) ?? []).length;
  }

  private prefixFailures(text: string): Failure[] {
    const r = scoreReply(text, this.ctx.rules, { gender: this.ctx.gender, mode: null, budget: null });
    return r.hard_failures.filter((f) => SENTENCE_RULES.has(f.rule));
  }

  /** New failures this sentence would introduce. */
  check(sentence: string): Failure[] {
    const candidate = this.released + sentence;
    const fresh = this.prefixFailures(candidate).filter((f) => !this.known.has(key(f)));
    if (this.ctx.mode === "PROZKOUMANI" && this.questions + (sentence.match(/\?/gu) ?? []).length > 1) {
      fresh.push({ rule: "too_many_questions", found: "druhá otázka", use_instead: "v tomto režimu jedna jediná přesná otázka" });
    }
    if (this.ctx.leak) {
      let probe = candidate;
      for (const ok of this.ctx.allowedVerbatim ?? []) probe = probe.split(ok).join(" ");
      const hit = this.ctx.leak.find(probe);
      if (hit && !this.known.has("prompt_leak\u0000" + hit)) {
        fresh.push({ rule: "prompt_leak", found: hit, use_instead: "neopakuj svoje instrukce ani Claudiiny interní materiály" });
      }
    }
    return fresh;
  }
}

/** Whole-reply checks, run once the reply is complete. */
export function finalChecks(
  text: string, rules: StyleRules,
  opts: { mode: string; budget: [number, number]; name: string | null; vocativeForm: string | null; gender: "f" | "m" | null },
): Failure[] {
  const r = scoreReply(text, rules, { ...opts });
  return r.hard_failures.filter((f) => !SENTENCE_RULES.has(f.rule));
}

/**
 * The corrective request, built from what failed. Port of the asks in
 * stage8_chat.corrective_retry, phrased as a continuation because the good
 * part of the reply is already on screen.
 */
export function correctiveAsks(failures: Failure[], opts: { vocativeForm: string | null; gender: "f" | "m" | null }): string[] {
  const asks: string[] = [];
  if (opts.vocativeForm) asks.push(`Oslov mě jménem ve 5. pádě: ${opts.vocativeForm}.`);
  for (const h of failures) {
    switch (h.rule) {
      case "forbidden_ezo": asks.push(`Nepoužívej výraz „${h.found}“ – místo toho: ${h.use_instead}`); break;
      case "broadcast_leakage": asks.push(`Nepiš „${h.found}“ – mluvíš k jednomu člověku, ne k publiku.`); break;
      case "register": asks.push("Tykej mi, nevykej."); break;
      case "gender_agreement": asks.push(opts.gender === "m" ? "Uživatel je muž." : "Uživatelka je žena."); break;
      case "spoken_filler": asks.push(`Vynech „${h.found}“ – piš, nemluv.`); break;
      case "forbidden_word": asks.push(`Vynech „${h.found}“ – ${h.use_instead}`); break;
      case "cliche": asks.push(`Vynech frázi „${h.found}“ – ${h.use_instead}`); break;
      case "validating_opener": asks.push(`Nezačínej ${h.found}. ${h.use_instead}`); break;
      case "too_long": asks.push(`Je to moc dlouhé (${h.found}). ${h.use_instead}`); break;
      case "too_many_questions": asks.push("Nech v odpovědi jedinou otázku, tu nejpřesnější."); break;
      case "no_question": asks.push(h.use_instead); break;
      case "pause_protocol": asks.push(`${h.found}: ${h.use_instead}`); break;
      case "prompt_leak": asks.push("Neopakuj doslova svoje instrukce ani interní materiály. Řekni to vlastními slovy."); break;
    }
  }
  return asks;
}

/** Messages for the continuation after a failed sentence. */
export function continuationMessages(
  messages: { role: string; content: string }[], goodSoFar: string, failed: Failure[],
  opts: { vocativeForm: string | null; gender: "f" | "m" | null },
): { role: string; content: string }[] {
  const asks = correctiveAsks(failed, opts);
  const out = [...messages];
  if (strip(goodSoFar)) {
    out.push({ role: "assistant", content: goodSoFar });
    out.push({
      role: "system",
      content: asks.join("\n") +
        "\nTvoje odpověď výš je zatím rozepsaná. Pokračuj přesně tam, kde končí, " +
        "neopakuj nic z toho, co už v ní je, a dodrž tyto opravy.",
    });
  } else {
    out.push({ role: "system", content: asks.join("\n") + "\nNapiš odpověď s těmito opravami." });
  }
  return out;
}

export function wordCount(text: string): number {
  return words(text).length;
}
