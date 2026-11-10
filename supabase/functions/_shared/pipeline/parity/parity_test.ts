// Parity suite: the TypeScript pipeline must do exactly what the Python did.
//
//   python3 supabase/functions/_shared/pipeline/parity/oracle.py --base "<AI APP>"
//   deno test -A supabase/functions/_shared/pipeline/parity/
//
// Skipped (not failed) when fixtures.json has not been generated, because the
// fixtures contain her knowledge base and are never committed.
import { deepStrictEqual } from "node:assert";

// node:assert rather than jsr:@std/assert so the suite runs with no registry access.
function assertEquals(actual: unknown, expected: unknown, msg?: string) {
  deepStrictEqual(JSON.parse(JSON.stringify(actual ?? null)), JSON.parse(JSON.stringify(expected ?? null)), msg);
}
import {
  addedSomething, budget, deterministicMode, enforceUnderstanding, knownFromHistory, modeBlock, parsePlanner,
  plan, plannerMessages, stalled, type Plan, type Turn,
} from "../modes.ts";
import { extraHardChecks, scoreReply, softFlags } from "../checks.ts";
import { vocative } from "../vocative.ts";
import { buildMessages, Library, type Pools } from "../prompt.ts";

const path = new URL("./fixtures.json", import.meta.url);
let F: any = null;
try {
  F = JSON.parse(await Deno.readTextFile(path));
} catch {
  console.warn("parity fixtures not found: run parity/oracle.py first. Skipping.");
}
const ignore = F === null;

// Python dicts come back with only the keys Python set; normalise TS plans the same way.
function pyPlan(p: Plan): Record<string, unknown> {
  const o: Record<string, unknown> = { ...p };
  for (const k of Object.keys(o)) if (o[k] === undefined) delete o[k];
  return o;
}

Deno.test({ name: "routing: deterministic rules and offline plan, every message", ignore, fn: async () => {
  let n = 0;
  for (const c of F.routing) {
    assertEquals(deterministicMode(c.msg), c.det, c.msg);
    assertEquals(pyPlan(await plan(c.msg)), c.plan, c.msg);
    n++;
  }
  console.log(`  ${n} messages routed identically`);
}});

Deno.test({ name: "round 1 feedback: 20/20 routed, 17/20 caught, identical findings", ignore, fn: () => {
  let routed = 0, caught = 0;
  for (const it of F.round1) {
    assertEquals(deterministicMode(it.q) ?? "PROZKOUMANI", it.got);
    if (it.got === it.want) routed++;
    const fails = extraHardChecks(it.round1, it.got, budget({ mode: it.got }));
    assertEquals(fails, it.failures, `item ${it.n}`);
    if (fails.some((f) => ["forbidden_word", "cliche", "validating_opener", "too_long", "pause_protocol"].includes(f.rule))) caught++;
  }
  assertEquals([routed, caught], [20, 17]);
}});

Deno.test({ name: "understanding gate: 306 conversations", ignore, fn: async () => {
  for (const c of F.gate) {
    const h = c.history as Turn[];
    assertEquals([...knownFromHistory(h, c.msg)].sort(), c.known, c.msg);
    assertEquals(addedSomething(h, c.msg), c.added, c.msg);
    assertEquals(stalled(h, c.msg), c.stalled, c.msg);
    const p = await plan(c.msg, h);
    assertEquals(pyPlan(p), c.plan, c.msg);
    assertEquals(pyPlan(enforceUnderstanding(p, h, c.msg)), c.enforced, c.msg);
  }
  // the six scripted conversations, with the modes the Python self-test expects
  const want = ["PROZKOUMANI", "VEDENI", "VEDENI", "VEDENI", "PROZKOUMANI", "HRANICE"];
  assertEquals(F.gate.slice(0, 6).map((c: any) => c.enforced.mode), want);
}});

Deno.test({ name: "planner: prompt and reply parsing", ignore, fn: async () => {
  for (const c of F.planner) {
    const p = await plan("Tohle je zpráva bez pravidla.", c.history, async () => c.raw);
    assertEquals(pyPlan(p), c.plan, c.raw);
    assertEquals(plannerMessages("Tohle je zpráva bez pravidla.", c.history), c.messages, "planner prompt");
  }
  assertEquals(parsePlanner("garbage", 2), null);
}});

Deno.test({ name: "mode blocks: 252 combinations, byte for byte", ignore, fn: () => {
  for (const b of F.blocks) {
    assertEquals(modeBlock(b.plan, b.recent), b.block, JSON.stringify(b.plan));
    assertEquals(budget(b.plan), b.budget);
  }
}});

Deno.test({ name: "checks: identical findings on 2,141 texts", ignore, fn: () => {
  let failing = 0;
  for (const c of F.checks) {
    const bud = c.budget as [number, number] | null;
    assertEquals(extraHardChecks(c.text, c.mode, bud), c.extra, c.text.slice(0, 80));
    assertEquals(softFlags(c.text, c.mode, bud), c.soft, c.text.slice(0, 80));
    const s = scoreReply(c.text, F.style_rules, { name: c.name, gender: c.gender, mode: c.mode, budget: bud });
    assertEquals(s, c.score, c.text.slice(0, 80));
    if (!s.passes_hard) failing++;
  }
  console.log(`  ${F.checks.length} texts, ${failing} with hard failures, all identical to the Python`);
}});

Deno.test({ name: "vocative", ignore, fn: () => {
  for (const v of F.vocative) assertEquals(vocative(v.name), v.voc, v.name);
}});

Deno.test({ name: "lexical collections: BM25 picks the same documents", ignore, fn: () => {
  const lib = new Library({ ...F.static, styleRules: F.style_rules });
  for (const b of F.bm25) {
    assertEquals(lib.searchRules(b.q, 2).map((x) => x.id), b.rules, b.q);
    assertEquals(lib.searchGuidePrinciples(b.q, 1).map((x) => x.id), b.principles, b.q);
    assertEquals(lib.searchFramework(b.q, 1).map((x) => x.id), b.framework, b.q);
    assertEquals(lib.searchGuideMap(b.q, 1).map((x) => x.id), b.gmap, b.q);
  }
}});

Deno.test({ name: "prompts: 156 turns assembled byte for byte", ignore, fn: () => {
  const lib = new Library({ ...F.static, styleRules: F.style_rules });
  let bytes = 0;
  for (const c of F.prompts) {
    const got = buildMessages({
      lib, userMsg: c.q, history: c.history, plan: c.plan, pools: c.pools as Pools, recent: c.recent,
      person: { name: c.name, vocative: c.vocative, gender: c.gender },
      withMemory: false,
    });
    assertEquals(got.used.exemplars.map((e) => e.id), c.exemplars, c.q);
    assertEquals(got.used.knowledge.map((e) => e.id), c.knowledge, c.q);
    assertEquals(got.messages.length, c.messages.length, c.q);
    for (let i = 0; i < c.messages.length; i++) {
      assertEquals(got.messages[i], c.messages[i], `${c.q} [message ${i}]`);
      bytes += c.messages[i].content.length;
    }
  }
  console.log(`  ${F.prompts.length} prompts, ${(bytes / 1e6).toFixed(1)}M characters, identical`);
}});

// Database -> TypeScript -> prompt. Pools come from public.retrieve_all (db_pools.py).
let D: any[] | null = null;
try {
  D = JSON.parse(await Deno.readTextFile(new URL("./db_pools.json", import.meta.url)));
} catch {
  // optional: needs a database
}
Deno.test({ name: "prompts from the database's own retrieval: identical to the Python", ignore: ignore || D === null, fn: () => {
  const lib = new Library({ ...F.static, styleRules: F.style_rules });
  const nfcDeep = (m: { role: string; content: string }[]) => m.map((x) => ({ role: x.role, content: x.content.normalize("NFC") }));
  for (let i = 0; i < F.prompts.length; i++) {
    const c = F.prompts[i];
    const pools = D![i] as Pools;
    const got = buildMessages({
      lib, userMsg: c.q, history: c.history, plan: c.plan, pools, recent: c.recent,
      person: { name: c.name, vocative: c.vocative, gender: c.gender }, withMemory: false,
    });
    // The loader stores text NFC-normalised (macOS exports mix NFD in); compare in NFC.
    assertEquals(nfcDeep(got.messages), nfcDeep(c.messages), c.q);
  }
  console.log(`  ${F.prompts.length} prompts built from database retrieval, identical`);
}});
