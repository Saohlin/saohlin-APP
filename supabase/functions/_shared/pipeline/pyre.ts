// Python-compatible text helpers for the pipeline port.
//
// The voice checks and the routing rules are Python regular expressions,
// written and tuned against Claudia's feedback. JavaScript regexes differ in
// ways that matter for Czech: `\w` and `\b` are ASCII-only in JS even with the
// `u` flag, and in Python they are Unicode. So "č" is a word character in
// Python and a boundary in JS, and a pattern like `(?<!\w)zkus` would fire
// inside "nezkusíš" if copied verbatim.
//
// `pyRe` translates a Python pattern into an equivalent JS RegExp instead of
// every pattern being rewritten by hand. The patterns in this port are copied
// character for character from the Python files, which is what the parity
// suite checks.

const W = "\\p{L}\\p{N}_";
const WORD = `[${W}]`;
const NOT_WORD = `[^${W}]`;
const BOUNDARY = `(?:(?<=${WORD})(?!${WORD})|(?<!${WORD})(?=${WORD}))`;
const NOT_BOUNDARY = `(?:(?<=${WORD})(?=${WORD})|(?<!${WORD})(?!${WORD}))`;

export interface PyFlags {
  i?: boolean; // re.I
  m?: boolean; // re.M
  g?: boolean; // for findall / split
}

const cache = new Map<string, RegExp>();

export function translate(pattern: string): string {
  let out = "";
  let inClass = false;
  for (let k = 0; k < pattern.length; k++) {
    const c = pattern[k];
    if (c === "\\" && k + 1 < pattern.length) {
      const n = pattern[k + 1];
      k++;
      if (n === "w") out += inClass ? W : WORD;
      else if (n === "W") out += inClass ? "" : NOT_WORD; // [^\W] never used in the patterns
      else if (n === "b") out += inClass ? "\\x08" : BOUNDARY;
      else if (n === "B") out += NOT_BOUNDARY;
      else if (n === "d") out += inClass ? "\\p{Nd}" : "\\p{Nd}";
      else if ("sStnrfvxu".includes(n) || "^$\\.*+?()[]{}|/".includes(n) || (n === "-" && inClass)) out += "\\" + n;
      else out += n; // Python lets any punctuation be escaped; JS u-mode does not
      continue;
    }
    if (inClass) {
      if (c === "]") inClass = false;
      if (c === "[") { out += "\\["; continue; } // literal in Python, an error in some JS modes
      out += c;
      continue;
    }
    if (c === "[") {
      inClass = true;
      out += c;
      // A leading ] or ^] is literal in Python.
      if (pattern[k + 1] === "^") { out += "^"; k++; }
      if (pattern[k + 1] === "]") { out += "\\]"; k++; }
      continue;
    }
    if (c === "{" && !/^\{\d*(,\d*)?\}/.test(pattern.slice(k))) { out += "\\{"; continue; }
    if (c === "}" ) {
      // a literal } is fine in Python; JS u-mode needs it escaped unless it closes a quantifier
      const before = out.lastIndexOf("{");
      if (before === -1 || /\}/.test(out.slice(before))) { out += "\\}"; continue; }
    }
    out += c;
  }
  return out;
}

export function pyRe(pattern: string, flags: PyFlags = {}): RegExp {
  const f = "u" + (flags.i ? "i" : "") + (flags.m ? "m" : "") + (flags.g ? "g" : "");
  const key = f + "\u0000" + pattern;
  let re = cache.get(key);
  if (!re) {
    re = new RegExp(translate(pattern), f);
    cache.set(key, re);
  }
  re.lastIndex = 0;
  return re;
}

/** re.search(...) is not None */
export function search(pattern: string, text: string, flags: PyFlags = {}): RegExpExecArray | null {
  return pyRe(pattern, { ...flags, g: false }).exec(text);
}

/** len(re.findall(...)) */
export function countAll(pattern: string, text: string, flags: PyFlags = {}): number {
  const re = pyRe(pattern, { ...flags, g: true });
  let n = 0;
  for (const _m of text.matchAll(re)) n++;
  return n;
}

/** re.findall with one group: the group values */
export function findAllGroup1(pattern: string, text: string, flags: PyFlags = {}): string[] {
  const re = pyRe(pattern, { ...flags, g: true });
  return [...text.matchAll(re)].map((m) => m[1] ?? m[0]);
}

/** re.split(pattern, text) for patterns without groups */
export function split(pattern: string, text: string, maxsplit = 0): string[] {
  const re = pyRe(pattern, { g: true });
  if (!maxsplit) return text.split(re);
  const out: string[] = [];
  let last = 0;
  let n = 0;
  for (const m of text.matchAll(re)) {
    if (n >= maxsplit) break;
    out.push(text.slice(last, m.index));
    last = (m.index ?? 0) + m[0].length;
    n++;
  }
  out.push(text.slice(last));
  return out;
}

/** re.escape */
export function escape(s: string): string {
  return s.replace(/[\\^$.*+?()[\]{}|\/]/g, (c) => "\\" + c);
}

/** unicodedata NFD, drop category Mn */
export function unaccent(s: string): string {
  return s.normalize("NFD").replace(/\p{Mn}/gu, "");
}

export function nfc(s: string): string {
  return s.normalize("NFC");
}

/** str.split() with no argument */
export function words(s: string): string[] {
  return s.split(/[\s\u001c-\u001f\u0085]+/u).filter((w) => w.length > 0);
}

/** str.strip() */
export function strip(s: string): string {
  return s.replace(/^[\s\u001c-\u001f\u0085]+|[\s\u001c-\u001f\u0085]+$/gu, "");
}

/** str.count(sub) */
export function count(s: string, sub: string): number {
  if (!sub) return s.length + 1;
  let n = 0;
  let i = 0;
  while ((i = s.indexOf(sub, i)) !== -1) { n++; i += sub.length; }
  return n;
}

/** Python's len() counts code points, JS .length counts UTF-16 units. */
export function pyLen(s: string): number {
  let n = 0;
  for (const _c of s) n++;
  return n;
}

/** s[:n] by code points */
export function pySlice(s: string, end: number): string {
  return Array.from(s).slice(0, end).join("");
}
