// Crisis handling, three layers (Chat Module Spec, Safety; G2.7).
//
//   1. keyword screen before anything else: the pipeline's own crisis pattern
//      plus the Czech list in app_config.crisis.patterns, diacritics-insensitive
//   2. classifier (luna) in parallel with the planner: none | low | elevated | acute
//   3. elevated or acute forces HRANICE with the crisis block; acute also sends
//      the helplines as a card
//
// The first sentence of a reply is held until the classifier has answered, so
// a crisis reply can never begin as coaching. Only crisis_flag is recorded.
import C from "./constants.json" with { type: "json" };
import { search, strip, unaccent } from "./pyre.ts";

export type CrisisLevel = "none" | "low" | "elevated" | "acute";
const ORDER: CrisisLevel[] = ["none", "low", "elevated", "acute"];

export function maxLevel(a: CrisisLevel, b: CrisisLevel): CrisisLevel {
  return ORDER.indexOf(a) >= ORDER.indexOf(b) ? a : b;
}

/** Layer 1. Returns 'elevated' on a hit: the classifier may raise it to acute, never lower it. */
export function keywordScreen(text: string, extraPatterns: string[] = []): CrisisLevel {
  if (search(C.modes.CRISIS.pattern, text, C.modes.CRISIS)) return "elevated";
  const flat = unaccent(text.toLowerCase());
  for (const p of extraPatterns) {
    try {
      if (search(unaccent(p.toLowerCase()), flat)) return "elevated";
    } catch {
      // a malformed pattern in config must not take the chat down
    }
  }
  return "none";
}

export const CLASSIFIER_SYSTEM = `Posuzuješ jednu zprávu z aplikace pro osobní a spirituální rozvoj. Neodpovídáš uživateli.
Rozhodni jen o jedné věci: je v té zprávě (v kontextu posledních zpráv) známka, že je člověk v ohrožení?

none      běžné téma, i když je smutné nebo bolestné (rozchod, samota, stres, ztráta)
low       silná bolest, beznaděj nebo vyčerpání, ale bez náznaku ublížení sobě nebo druhým
elevated  náznak, že nechce žít, že by si mohl ublížit, že by mohl ublížit druhému, nebo že je v nebezpečí (násilí doma)
acute     jasný úmysl, plán, prostředky nebo časový údaj; nebo že se to právě děje

Při pochybnosti mezi dvěma stupni zvol vyšší.
Vrať POUZE JSON: {"level": "none" | "low" | "elevated" | "acute"}`;

export function classifierMessages(userMsg: string, recentUserTurns: string[] = []): { role: string; content: string }[] {
  const ctx = recentUserTurns.slice(-2).map((t) => `DŘÍVE: ${t}`);
  return [
    { role: "system", content: CLASSIFIER_SYSTEM },
    { role: "user", content: [...ctx, `ZPRÁVA: ${userMsg}`].join("\n\n") },
  ];
}

/** Parse the classifier; anything unreadable counts as 'low' so a failure never silences a real signal. */
export function parseClassifier(raw: string): CrisisLevel {
  try {
    const got = JSON.parse(strip(raw.replace(/^```(?:json)?|```$/gm, "")));
    const level = String(got?.level ?? "").toLowerCase();
    if ((ORDER as string[]).includes(level)) return level as CrisisLevel;
  } catch {
    // fall through
  }
  return "low";
}

export function forcesBoundary(level: CrisisLevel): boolean {
  return level === "elevated" || level === "acute";
}
