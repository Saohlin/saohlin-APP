// Response modes: decide the SHAPE of the reply before writing it.
// Port of AI APP/scripts/response_modes.py. The reasons behind every rule are
// documented there, next to Claudia's feedback lines; the constants (mode
// texts, patterns, budgets) are exported from that file into constants.json.
import C from "./constants.json" with { type: "json" };
import { pyLen, pySlice, search, strip } from "./pyre.ts";

const M = C.modes;

export type Mode = "PROZKOUMANI" | "VEDENI" | "VYSVETLENI" | "PAUZA" | "HRANICE" | "IDENTITA" | "KARTA";
export type UnderstandingKey = "situace" | "chovani" | "opakovani" | "pod_tim";
export interface Turn { role: "user" | "assistant"; content: string }

export interface Plan {
  mode: Mode;
  vim?: UnderstandingKey[];
  chybi: string;
  otazka: string;
  how: string;
  turn: number;
  chybi_ctyri?: UnderstandingKey[];
  explore_turn?: number;
}

export const MODES = M.MODES as unknown as Record<Mode, { label: string; budget: [number, number]; instruction: string }>;
export const DEFAULT_MODE = M.DEFAULT_MODE as Mode;
export const UNDERSTANDING_KEYS = M.UNDERSTANDING_KEYS as UnderstandingKey[];
export const PLANNER_SYSTEM: string = M.PLANNER_SYSTEM;
export const TIC_WORDS: string[] = M.TIC_WORDS;
const RETRIEVAL = M.RETRIEVAL as unknown as Record<string, [number, number, number]>;
const PHASE2 = M.PHASE2 as unknown as Record<string, [number, number, number]>;
const TOKEN_BUDGET = M.RETRIEVED_TOKEN_BUDGET as Record<string, number>;
export const CHARS_PER_TOKEN: number = M.CHARS_PER_TOKEN;
const PINNED = M.PINNED as Record<string, string[]>;
const STOP = new Set<string>(M.STOP);

type Rx = { pattern: string; i: boolean; m: boolean };
const has = (rx: Rx, text: string) => search(rx.pattern, text, rx) !== null;

export function retrievalSizes(p?: { mode?: string } | null): [number, number, number] {
  return RETRIEVAL[p?.mode ?? ""] ?? [5, 2, 2];
}
export function phase2Sizes(p?: { mode?: string } | null): [number, number, number] {
  return PHASE2[p?.mode ?? ""] ?? [2, 1, 1];
}
export function tokenBudget(p?: { mode?: string } | null): number {
  return TOKEN_BUDGET[p?.mode ?? ""] ?? 9000;
}
export function pinnedSources(p?: { mode?: string } | null): string[] {
  return PINNED[p?.mode ?? ""] ?? [];
}
export function budget(p: { mode: string }): [number, number] {
  return (MODES[p.mode as Mode] ?? MODES[DEFAULT_MODE]).budget;
}

/** Greedy fill; `keepFirst` items are kept whatever they cost (pinned passages). */
export function fitToBudget<T extends object>(
  items: T[], budgetTokens: number, key = "text", keepFirst = 0,
): [T[], number] {
  const out: T[] = [];
  let spent = 0;
  items.forEach((it, i) => {
    const cost = pyLen(String((it as Record<string, unknown>)[key] ?? "")) / CHARS_PER_TOKEN;
    if (i < keepFirst || spent + cost <= budgetTokens || out.length === 0) {
      out.push(it);
      spent += cost;
    }
  });
  return [out, Math.trunc(spent)];
}

// Deterministic routing ----------------------------------------------------------

export function deterministicMode(userMsg: string): Mode | null {
  const m = userMsg ?? "";
  if (has(M.CRISIS, m)) return "HRANICE";
  if (has(M.IDENTITY, m)) return "IDENTITA";
  if (has(M.EXISTENTIAL, m)) return "VYSVETLENI";
  if (has(M.PAUSE, m)) return has(M.NOT_WORKING, m) ? "PROZKOUMANI" : "PAUZA";
  if (has(M.SAFETY, m)) return "HRANICE";
  if (has(M.CARD, m)) return "KARTA";
  if (has(M.DEFINITION, m)) return "VYSVETLENI";
  return null;
}

// The planner ----------------------------------------------------------------------

export type PlannerCall = (messages: { role: string; content: string }[]) => Promise<string>;

/** The planner's input messages (identical to the Python). */
export function plannerMessages(userMsg: string, history: Turn[]): { role: string; content: string }[] {
  const convo = history.slice(-6).map((m) => `${m.role === "user" ? "UŽIVATEL" : "CLAUDIA AI"}: ${m.content ?? ""}`);
  convo.push(`UŽIVATEL: ${userMsg}`);
  return [
    { role: "system", content: PLANNER_SYSTEM },
    { role: "user", content: convo.join("\n\n") },
  ];
}

/** Parse the planner's reply. Returns null when it cannot be used. */
export function parsePlanner(raw: string, turn: number): Plan | null {
  let got: Record<string, unknown>;
  try {
    const txt = strip(strip(raw).replace(/^```(?:json)?|```$/gm, ""));
    got = JSON.parse(txt);
  } catch {
    return null;
  }
  if (!got || typeof got !== "object") return null;
  let mode = String(got.mode ?? "").toUpperCase();
  if (mode === "VEDENI" && turn <= 1) mode = "PROZKOUMANI";
  if (mode !== "PROZKOUMANI" && mode !== "VEDENI") return null;
  let vim = got.vim ?? [];
  if (!Array.isArray(vim)) vim = [vim];
  const vimSet = (vim as unknown[]).map((x) => strip(String(x)).toLowerCase());
  return {
    mode: mode as Mode,
    vim: UNDERSTANDING_KEYS.filter((k) => vimSet.includes(k)),
    chybi: pySlice(String(got.chybi ?? ""), 300),
    otazka: pySlice(String(got.otazka ?? ""), 300),
    how: !(mode === "PROZKOUMANI" && turn <= 1) ? "planner" : "planner+turn1",
    turn,
  };
}

/** Deterministic rules first, then the planner, then the offline rule. */
export async function plan(userMsg: string, history: Turn[] = [], callFn?: PlannerCall | null): Promise<Plan> {
  const turn = 1 + history.filter((m) => m.role === "user").length;
  const det = deterministicMode(userMsg);
  if (det) return { mode: det, chybi: "", otazka: "", how: "rule", turn };

  if (callFn) {
    try {
      const parsed = parsePlanner(await callFn(plannerMessages(userMsg, history)), turn);
      if (parsed) return parsed;
    } catch {
      // fall through to the rule
    }
  }
  return planFallback(userMsg, history, turn);
}

export function planFallback(userMsg: string, history: Turn[], turn: number): Plan {
  const known = knownFromHistory(history, userMsg);
  const explore = known.size < UNDERSTANDING_KEYS.length && addedSomething(history, userMsg);
  return {
    mode: turn <= 1 || explore ? "PROZKOUMANI" : "VEDENI",
    vim: [...known].sort() as UnderstandingKey[],
    chybi: "", otazka: "", how: "fallback", turn,
  };
}

// The understanding gate -------------------------------------------------------------

function contentWords(text: string): Set<string> {
  const out = new Set<string>();
  for (const w of (text ?? "").toLowerCase().match(/[\p{L}\p{N}_]+/gu) ?? []) {
    if (pyLen(w) > 3 && !STOP.has(w)) out.add(w);
  }
  return out;
}

function userTexts(history: Turn[], userMsg?: string | null): string[] {
  const out = (history ?? []).filter((m) => m.role === "user").map((m) => m.content ?? "");
  if (userMsg !== undefined && userMsg !== null) out.push(userMsg);
  return out;
}

export function knownFromHistory(history: Turn[], userMsg?: string | null): Set<UnderstandingKey> {
  const texts = userTexts(history, userMsg);
  const joined = texts.join("\n");
  const known = new Set<UnderstandingKey>();
  const nWords = texts.reduce((a, t) => a + t.split(/\s+/u).filter(Boolean).length, 0);
  if (nWords >= 12) known.add("situace");
  if (has(M.RE_BEHAVIOUR, joined)) known.add("chovani");
  if (has(M.RE_REPEAT, joined)) known.add("opakovani");
  if (has(M.RE_UNDERNEATH, joined)) known.add("pod_tim");
  return known;
}

export function addedSomething(history: Turn[], userMsg?: string | null, floor = 4): boolean {
  const texts = userTexts(history, userMsg);
  if (texts.length < 2) return true;
  const seen = new Set<string>();
  for (const t of texts.slice(0, -1)) for (const w of contentWords(t)) seen.add(w);
  let fresh = 0;
  for (const w of contentWords(texts[texts.length - 1])) if (!seen.has(w)) fresh++;
  return fresh >= floor;
}

export function stalled(history: Turn[], userMsg?: string | null, floor = 4): boolean {
  const texts = userTexts(history, userMsg);
  if (texts.length < 3) return false;
  for (const cut of [0, 1]) {
    const sub = texts.slice(0, texts.length - cut);
    const seen = new Set<string>();
    for (const t of sub.slice(0, -1)) for (const w of contentWords(t)) seen.add(w);
    let fresh = 0;
    for (const w of contentWords(sub[sub.length - 1])) if (!seen.has(w)) fresh++;
    if (fresh >= floor) return false;
  }
  return true;
}

export function enforceUnderstanding(p: Plan, history: Turn[], userMsg?: string | null): Plan {
  const out: Plan = { ...p };
  const known = knownFromHistory(history, userMsg);
  for (const k of p.vim ?? []) if (UNDERSTANDING_KEYS.includes(k)) known.add(k);
  const missing = UNDERSTANDING_KEYS.filter((k) => !known.has(k));
  out.vim = UNDERSTANDING_KEYS.filter((k) => known.has(k));
  out.chybi_ctyri = missing;

  if (p.mode !== "PROZKOUMANI" && p.mode !== "VEDENI") return out;

  const priorAssistant = (history ?? []).filter((m) => m.role === "assistant").length;
  out.explore_turn = priorAssistant + 1;

  if (missing.length === 0) {
    if (out.mode !== "VEDENI") {
      out.mode = "VEDENI";
      out.how = (p.how ?? "?") + "+understood";
      out.chybi = "";
    }
    return out;
  }
  if (priorAssistant >= 1 && stalled(history, userMsg)) {
    if (out.mode !== "VEDENI") {
      out.mode = "VEDENI";
      out.how = (p.how ?? "?") + "+stalled";
      out.chybi = "";
    }
    return out;
  }
  if (out.mode !== "PROZKOUMANI" && priorAssistant >= 1) {
    out.mode = "PROZKOUMANI";
    out.how = (p.how ?? "?") + "+missing";
  }
  return out;
}

// The instruction block for this turn ----------------------------------------------------

export function modeBlock(p: Plan, recent?: string[] | null): string {
  const m = MODES[p.mode] ?? MODES[DEFAULT_MODE];
  const parts = [m.instruction];
  if (p.mode === "PROZKOUMANI" && (p.explore_turn ?? 1) >= 2) {
    parts.push(
      "\nTOHLE UŽ NENÍ PRVNÍ OTÁZKA. Člověk ti právě něco odpověděl, takže " +
        "než se zeptáš znovu, MUSÍŠ mu něco dát:\n" +
        "  • buď pojmenuj, co v tom, co napsal, vidíš — konkrétně, jeho slovy,\n" +
        "  • nebo vyslov dohad: „přijde mi, že…“, „to zní, jako by…“\n" +
        "A teprve potom polož jednu přesnou otázku, která jde o kus hloub. " +
        "Otázka po pozorování zní jako porozumění. Otázka po ničem zní jako " +
        "výslech a přesně to Claudia odmítla.",
    );
  }
  const ctyri = p.chybi_ctyri;
  if (ctyri && ctyri.length) {
    const label: Record<string, string> = {
      situace: "co se konkrétně stalo",
      chovani: "co s tím sám udělal",
      opakovani: "co se mu v tom opakuje",
      pod_tim: "co je pod tím — čeho se bojí, co si o sobě myslí",
    };
    parts.push("\nJeště nevíš: " + ctyri.map((k) => label[k] ?? k).join("; ") + ". Otázka míří na první z toho, co chybí.");
  }
  if (p.chybi) parts.push(`\nCo o jeho situaci zatím nevíš: ${p.chybi}`);
  if (p.otazka) {
    parts.push(`Navržená otázka. NEOPISUJ ji doslova, polož ji svými slovy a k jeho situaci: ${p.otazka}`);
  }
  if (recent && recent.length) {
    parts.push(
      "\nTAKHLE JSI ZAČALA POSLEDNÍ ODPOVĚDI:\n  " +
        recent.slice(-5).map((r) => `„${r}…“`).join("\n  ") +
        "\nZačni jinak. Stejný začátek podruhé zní jako šablona a " +
        "Claudia to pozná okamžitě. Slovo „příležitost“ použij nanejvýš " +
        "v jedné odpovědi z pěti — jinde pojmenuj konkrétně, co ta " +
        "situace tomu člověku umožňuje změnit.",
    );
  }
  return parts.join("\n");
}
