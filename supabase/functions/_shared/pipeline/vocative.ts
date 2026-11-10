// Czech 5th case (port of stage8_chat.vocative).
//
// In the app the vocative is confirmed by the user at sign-up and stored on
// the profile; the prompt always uses the stored value. This rule-based
// version is the fallback and what the parity suite pins.
import C from "./constants.json" with { type: "json" };
import { strip, unaccent } from "./pyre.ts";

const OVERRIDES = C.chat.OVERRIDES as Record<string, string>;

export function vocative(name: string | null | undefined): string {
  if (!name) return "";
  const n = strip(name);
  const key = unaccent(n.toLowerCase());
  if (key in OVERRIDES) return OVERRIDES[key];
  const low = n.toLowerCase();
  const chars = Array.from(n);
  const cut = (k: number) => chars.slice(0, chars.length - k).join("");
  if (low.endsWith("a")) return cut(1) + "o";
  const last = Array.from(low).at(-1) ?? "";
  if ("eiyou".includes(last)) return n;
  if (low.endsWith("í")) return n;
  if (low.endsWith("ek")) return cut(2) + "ku";
  if (low.endsWith("k")) return n + "u";
  if ("šžčřjťďň".includes(last)) return n + "i";
  if (low.endsWith("ch") || "hg".includes(last)) return n + "u";
  if (low.endsWith("el") && chars.length > 3) return cut(2) + "le";
  return n + "e";
}
