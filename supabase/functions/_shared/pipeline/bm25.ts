// BM25 over unaccented, prefix-stemmed tokens. Port of stage6_retrieval_eval.
// Used for the small lexical collections (behaviour rules, guide principles,
// the card framework, the guide-map fallback), exactly as the Python does.
import C from "./constants.json" with { type: "json" };
import { unaccent } from "./pyre.ts";

const STOP = new Set<string>(C.bm25.STOP);
const STEM_LEN: number = C.bm25.STEM_LEN;

export function tokens(text: string): string[] {
  const flat = unaccent(text.toLowerCase());
  const out: string[] = [];
  for (const w of flat.match(/[a-z0-9]+/g) ?? []) {
    if (w.length < 3 || STOP.has(w)) continue;
    out.push(w.slice(0, STEM_LEN));
  }
  return out;
}

export class BM25 {
  private tf: Map<string, number>[] = [];
  private len: number[] = [];
  private idf = new Map<string, number>();
  private postings = new Map<string, number[]>();
  private avgdl: number;
  readonly N: number;

  constructor(docs: string[], private k1 = 1.5, private b = 0.75) {
    this.N = docs.length;
    const df = new Map<string, number>();
    for (const d of docs) {
      const c = new Map<string, number>();
      const t = tokens(d);
      for (const term of t) c.set(term, (c.get(term) ?? 0) + 1);
      this.tf.push(c);
      this.len.push(t.length);
      for (const term of c.keys()) df.set(term, (df.get(term) ?? 0) + 1);
    }
    this.avgdl = this.len.reduce((a, x) => a + x, 0) / Math.max(this.N, 1);
    for (const [t, n] of df) this.idf.set(t, Math.log(1 + (this.N - n + 0.5) / (n + 0.5)));
    this.tf.forEach((c, i) => {
      for (const term of c.keys()) {
        if (!this.postings.has(term)) this.postings.set(term, []);
        this.postings.get(term)!.push(i);
      }
    });
  }

  /** [docIndex, score] best first, like the Python (stable for ties). */
  search(query: string, k = 5): [number, number][] {
    const scores = new Map<number, number>();
    for (const term of tokens(query)) {
      const idf = this.idf.get(term);
      if (idf === undefined) continue;
      for (const i of this.postings.get(term) ?? []) {
        const f = this.tf[i].get(term)!;
        const dl = this.len[i];
        scores.set(i, (scores.get(i) ?? 0) +
          idf * f * (this.k1 + 1) / (f + this.k1 * (1 - this.b + this.b * dl / Math.max(this.avgdl, 1))));
      }
    }
    return [...scores.entries()].sort((a, b) => b[1] - a[1]).slice(0, k);
  }
}
