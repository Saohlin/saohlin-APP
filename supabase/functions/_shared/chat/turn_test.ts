// The chat turn against the real schema (migrations + knowledge base) and a
// scripted model. Needs a database with the migrations applied and load_kb.py
// run; skipped when DATABASE_URL is not set.
//
//   DATABASE_URL=postgres://postgres@localhost:54322/saohlin_test deno test -A supabase/functions/_shared/chat/
import { deepStrictEqual, ok } from "node:assert";
import postgres from "npm:postgres@3";
import type { ChatEvent, ChatRequest } from "./contract.ts";
import { parseRequest, InvalidInput } from "./contract.ts";
import { type AI, type ChatMessage, type CallOpts, ProviderError } from "./openai.ts";
import { type Db, DbError, resetKbCache, runTurn } from "./turn.ts";

const DSN = Deno.env.get("DATABASE_URL");
const ignore = !DSN;
const eq = (a: unknown, b: unknown, m?: string) => deepStrictEqual(a, b, m);

// ---------------------------------------------------------------- the database port over postgres.js

function pgDb(sql: postgres.Sql): Db {
  // postgres.js asks the server for parameter types and serialises objects for jsonb itself.
  const lit = (v: unknown) => (v === undefined ? null : v);
  return {
    async rpc<T>(fn: string, args: Record<string, unknown>) {
      const keys = Object.keys(args);
      const call = `select public.${fn}(${keys.map((k, i) => `${k} => $${i + 1}`).join(", ")}) as r`;
      try {
        const rows = await sql.unsafe(call, keys.map((k) => lit(args[k])) as any[]);
        return rows[0].r as T;
      } catch (e: any) {
        throw new DbError(e.code ?? "unknown", e.message);
      }
    },
    async config(keys: string[]) {
      const rows = await sql`select key, value from public.app_config where key = any(${keys})`;
      return Object.fromEntries(rows.map((r: any) => [r.key, r.value]));
    },
  };
}

// ---------------------------------------------------------------- a scripted model

interface Script {
  planner?: string | Error;
  crisis?: string | Error;
  replies: (string | Error | "hang")[];
}
class FakeAI implements AI {
  calls: { kind: string; model: string; messages?: ChatMessage[] }[] = [];
  constructor(private s: Script) {}
  async chat(messages: ChatMessage[], o: CallOpts) {
    const isCrisis = messages[0].content.startsWith("Posuzuješ jednu zprávu");
    this.calls.push({ kind: isCrisis ? "crisis" : "planner", model: o.model, messages });
    const v = isCrisis ? (this.s.crisis ?? '{"level":"none"}') : (this.s.planner ?? '{"mode":"PROZKOUMANI","vim":[],"chybi":"","otazka":""}');
    if (v instanceof Error) throw v;
    return { text: v, usage: { prompt_tokens: 400, completion_tokens: 30 } };
  }
  async *chatStream(messages: ChatMessage[], o: CallOpts) {
    this.calls.push({ kind: "reply", model: o.model, messages });
    const v = this.s.replies.shift() ?? "";
    if (v instanceof Error) throw v;
    if (v === "hang") {
      await new Promise((_, rej) => o.signal?.addEventListener("abort", () => rej(new ProviderError("timeout", 0, "aborted"))));
      return;
    }
    for (let i = 0; i < v.length; i += 7) {
      if (o.signal?.aborted) throw new ProviderError("timeout", 0, "aborted");
      yield { delta: v.slice(i, i + 7) };
    }
    yield { usage: { prompt_tokens: 16000, completion_tokens: 90, prompt_tokens_details: { cached_tokens: 12000 } } };
  }
  async embed(_t: string) {
    this.calls.push({ kind: "embed", model: "emb" });
    return { vector: Array.from({ length: 1024 }, (_, i) => (i === 3 ? 1 : 0)), usage: { prompt_tokens: 20 } };
  }
}

// ---------------------------------------------------------------- helpers

let sql: postgres.Sql;
let db: Db;
const EVA = "00000000-0000-0000-0000-0000000000e1";
const PETR = "00000000-0000-0000-0000-0000000000e2";

async function setup() {
  sql = postgres(DSN!, { max: 4, onnotice: () => {}, ...(Deno.env.get("PGHOST") ? { host: Deno.env.get("PGHOST") } : {}) });
  db = pgDb(sql);
  resetKbCache();
  await sql`delete from auth.users where id in (${EVA}, ${PETR})`;
  await sql`insert into auth.users (id, email, raw_user_meta_data) values
    (${EVA}, 'eva@test.local', ${sql.json({ profile: { displayName: "Eva", vocative: "Evo", dateOfBirth: "1990-01-01", gender: "female" }, consent: { accepted: true } })}),
    (${PETR}, 'petr@test.local', ${sql.json({ profile: { displayName: "Petr", vocative: "Petře", dateOfBirth: "1985-01-01", gender: "male" }, consent: { accepted: true } })})`;
  await sql`update public.app_config set value = '100' where key = 'limits.rate_per_minute'`;
  await sql`update public.app_config set value = '[]' where key = 'crisis.resources'`;
}
async function teardown() {
  await sql`delete from auth.users where id in (${EVA}, ${PETR})`;
  await sql.end();
}

const uuid = () => crypto.randomUUID();
const req = (text: string, extra: Partial<ChatRequest> = {}): ChatRequest =>
  ({ clientMsgId: uuid(), conversationId: null, text, inputMethod: "text", resumeMessageId: null, origin: "chat", ...extra });

async function turn(user: string, r: ChatRequest, script: Script, opts: { production?: boolean; firstDeltaMs?: number } = {}) {
  const events: ChatEvent[] = [];
  const ai = new FakeAI(script);
  await runTurn({ db, ai, production: !!opts.production, timeouts: { firstDeltaMs: opts.firstDeltaMs ?? 20000 } }, user, r, (e) => events.push(e));
  const text = events.filter((e) => e.event === "delta").map((e: any) => e.data.text).join("");
  return { events, ai, text, kinds: events.map((e) => e.event) };
}
async function storedReply(userMessageId: string) {
  const [r] = await sql`select private.decrypt(m.user_id, m.content_enc) as text, m.mode, mm.retried, mm.hard_failures,
      mm.crisis_flag, mm.timings, mm.tokens_in, mm.tokens_cached
    from public.messages m join public.message_meta mm on mm.message_id = m.id where m.reply_to = ${userMessageId}`;
  return r;
}
const trialUsed = async (u: string) => (await sql`select trial_used from public.usage_state where user_id = ${u}`)[0].trial_used;
const statusOf = async (id: string) => (await sql`select status from public.messages where id = ${id}`)[0].status;

// ---------------------------------------------------------------- tests

Deno.test("request contract: strict body, unknown fields rejected", () => {
  const id = uuid();
  eq(parseRequest({ clientMsgId: id, conversationId: null, text: "Ahoj", inputMethod: "text", resumeMessageId: null }).text, "Ahoj");
  for (const bad of [
    { clientMsgId: id, text: "x", userId: "someone-else" },
    { clientMsgId: "nope", text: "x" },
    { clientMsgId: id, text: "   " },
    { clientMsgId: id, text: "x".repeat(4001) },
    { clientMsgId: id, text: "x", inputMethod: "fax" },
    [],
  ]) {
    let threw = false;
    try { parseRequest(bad); } catch (e) { threw = e instanceof InvalidInput; }
    ok(threw, JSON.stringify(bad).slice(0, 60));
  }
  eq(parseRequest({ clientMsgId: id, text: "", resumeMessageId: uuid() }).text, "", "a resume carries no text");
});

Deno.test({ name: "a turn end to end: accepted, sentences, done, stored with meta, retrievals and cost rows", ignore, sanitizeResources: false, sanitizeOps: false, fn: async () => {
  await setup();
  try {
    const reply = "Evo, to, co popisuješ, je jasné znamení. Co se v tobě ozvalo jako první, když ti to napsal?";
    const r = await turn(EVA, req("Rozešel se se mnou přítel a pořád čekám, jestli se mi ozve."), { replies: [reply] });
    eq(r.kinds[0], "accepted");
    eq(r.kinds.at(-1), "done");
    eq(r.kinds.filter((k) => k === "delta").length, 2, "released sentence by sentence");
    eq(r.text, reply);
    const acc: any = r.events[0].data;
    eq(acc.trialRemaining, 4);
    const s = await storedReply(acc.userMessageId);
    eq(s.text, reply);
    eq(s.mode, "PROZKOUMANI");
    eq(s.retried, false);
    ok(s.timings.first_delta >= 0 && s.timings.retrieve >= 0 && s.timings.start_turn >= 0);
    eq([s.tokens_in, s.tokens_cached], [16000, 12000]);
    const ret = await sql`select collection, count(*)::int n from public.message_retrievals r
      join public.messages m on m.id = r.message_id where m.reply_to = ${acc.userMessageId} group by 1 order by 1`;
    ok(ret.some((x: any) => x.collection === "knowledge" && x.n >= 1));
    ok(ret.some((x: any) => x.collection === "exemplar" && x.n === 3));
    const calls = await sql`select purpose, ok from ops.ai_calls where message_id = ${acc.userMessageId} order by purpose`;
    eq(calls.map((c: any) => c.purpose), ["crisis", "embedding", "planner", "reply"]);
    eq(await statusOf(acc.userMessageId), "complete");

    // the prompt: persona first, the stored vocative, her exemplars, the message last
    const sent = r.ai.calls.find((c) => c.kind === "reply")!.messages!;
    ok(sent[0].content.startsWith("Jsi CLAUDIA AI. Odpovídáš výhradně česky.\n\n=== STYLOVÁ KARTA (jak píšeš) ==="));
    ok(sent.at(-2)!.content.includes("Oslov ji jménem v 5. pádě: Evo. Nepoužívej 1. pád (Eva). Tykej."));
    ok(sent.at(-2)!.content.includes("Uživatelka je žena."));
    eq(sent.at(-1), { role: "user", content: "Rozešel se se mnou přítel a pořád čekám, jestli se mi ozve." });
  } finally { await teardown(); }
}});

Deno.test({ name: "a sentence that breaks her rules is never shown; one corrective continuation", ignore, sanitizeResources: false, sanitizeOps: false, fn: async () => {
  await setup();
  try {
    const r = await turn(EVA, req("Nevím, co mám dělat, když mi pořád nepíše."), {
      planner: '{"mode":"VEDENI","vim":["situace"],"chybi":"","otazka":""}',
      replies: [
        "Evo, jeho mlčení ti něco ukazuje. Zkus se na chvíli nadechnout. Pak...",
        "Nadechni se a podívej se, komu dáváš svou pozornost. Co se v tobě ozve, když mu nenapíšeš?",
      ],
    });
    ok(!r.text.toLowerCase().includes("zkus"), "the hedged zkus never reached the phone");
    eq(r.text, "Evo, jeho mlčení ti něco ukazuje. Nadechni se a podívej se, komu dáváš svou pozornost. Co se v tobě ozve, když mu nenapíšeš?");
    const s = await storedReply((r.events[0].data as any).userMessageId);
    eq(s.text, r.text);
    eq(s.retried, true);
    ok(s.hard_failures.includes("forbidden_word"));
    const cont = r.ai.calls.filter((c) => c.kind === "reply")[1].messages!;
    eq(cont.at(-2), { role: "assistant", content: "Evo, jeho mlčení ti něco ukazuje. " });
    ok(cont.at(-1)!.content.includes("Pokračuj přesně tam, kde končí"));
  } finally { await teardown(); }
}});

Deno.test({ name: "if the continuation fails too, the reply ends at the last good sentence", ignore, sanitizeResources: false, sanitizeOps: false, fn: async () => {
  await setup();
  try {
    const r = await turn(EVA, req("Nevím, co mám dělat."), {
      replies: ["Evo, jsi tady správně. To musí být opravdu těžké.", "Je přirozené, že to bolí. Zkus to."],
    });
    eq(r.text, "Evo, jsi tady správně. ");
    eq(r.kinds.at(-1), "done");
    eq((await storedReply((r.events[0].data as any).userMessageId)).text, "Evo, jsi tady správně.");
  } finally { await teardown(); }
}});

Deno.test({ name: "no passing sentence at all: a retryable error, and the retry is not counted again", ignore, sanitizeResources: false, sanitizeOps: false, fn: async () => {
  await setup();
  try {
    const first = req("Pořád čekám na jeho zprávu.");
    const r = await turn(EVA, first, { replies: ["To musí být opravdu těžké. ", "Zkus se nadechnout. "] });
    eq(r.events.at(-1), { event: "error", data: { code: "AI_UNAVAILABLE", retryable: true } });
    const id = (r.events[0].data as any).userMessageId;
    eq(await statusOf(id), "failed");
    eq(await trialUsed(EVA), 1);
    const again = await turn(EVA, first, { replies: ["Evo, co se v tobě ozvalo, když nenapsal?"] });
    eq(again.kinds.at(-1), "done");
    eq(await trialUsed(EVA), 1, "our own failure is free");
  } finally { await teardown(); }
}});

Deno.test({ name: "credit exhausted: stop, not retryable, and the trial reply stays used", ignore, sanitizeResources: false, sanitizeOps: false, fn: async () => {
  await setup();
  try {
    const r = await turn(EVA, req("Ahoj, potřebuju poradit."), { replies: [new ProviderError("credit_exhausted", 429, "insufficient_quota")] });
    eq(r.events.at(-1), { event: "error", data: { code: "CREDIT_EXHAUSTED", retryable: false } });
    eq(await statusOf((r.events[0].data as any).userMessageId), "failed");
    eq(await trialUsed(EVA), 1);
    const c = await sql`select ok, error_code from ops.ai_calls where purpose = 'reply' and user_id = ${EVA}`;
    eq(c.map((x: any) => [x.ok, x.error_code]), [[false, "insufficient_quota"]]);
  } finally { await teardown(); }
}});

Deno.test({ name: "the model never answers: aborted at the deadline, retryable", ignore, sanitizeResources: false, sanitizeOps: false, fn: async () => {
  await setup();
  try {
    const r = await turn(EVA, req("Ahoj."), { replies: ["hang"] }, { firstDeltaMs: 150 });
    eq(r.events.at(-1), { event: "error", data: { code: "AI_UNAVAILABLE", retryable: true } });
  } finally { await teardown(); }
}});

Deno.test({ name: "a repeated clientMsgId after the reply is replayed, with no model call and no count", ignore, sanitizeResources: false, sanitizeOps: false, fn: async () => {
  await setup();
  try {
    const q = req("Mám pocit, že nejsem dost dobrá.");
    const reply = "Evo, co ti to říká o tom, jak se na sebe díváš?";
    const a = await turn(EVA, q, { replies: [reply] });
    const b = await turn(EVA, q, { replies: [] });
    eq(b.text, reply);
    eq(b.ai.calls.length, 0);
    eq((b.events.at(-1) as any).data.assistantMessageId, (a.events.at(-1) as any).data.assistantMessageId);
    eq(await trialUsed(EVA), 1);
  } finally { await teardown(); }
}});

Deno.test({ name: "crisis: forced HRANICE, crisis card from config, flag stored", ignore, sanitizeResources: false, sanitizeOps: false, fn: async () => {
  await setup();
  try {
    await sql`update public.app_config set value = ${sql.json([{ name: "Test line", phone: "000 000" }])} where key = 'crisis.resources'`;
    const r = await turn(PETR, req("Už nechci žít, nemá to cenu."), {
      crisis: '{"level":"acute"}',
      replies: ["Petře, slyším, jak těžké to teď je. Jsem AI průvodce a nejsem krizová pomoc. Zavolej prosím hned na linku níž, jsou tam pro tebe."],
    });
    const sent = r.ai.calls.find((c) => c.kind === "reply")!.messages!;
    ok(sent.at(-2)!.content.includes("=== BEZPEČÍ MÁ PŘEDNOST ==="));
    ok(sent.at(-2)!.content.includes("REŽIM: HRANICE"));
    eq(r.kinds.slice(-2), ["crisis", "done"]);
    eq((r.events.at(-1) as any).data.mode, "HRANICE");
    const s = await storedReply((r.events[0].data as any).userMessageId);
    eq(s.crisis_flag, true);
    const ev = await sql`select event_kind from public.messages where user_id = ${PETR} and role = 'event'`;
    eq(ev.map((x: any) => x.event_kind), ["crisis_resources"]);
  } finally { await teardown(); }
}});

Deno.test({ name: "production refuses to chat while the crisis numbers are unconfirmed", ignore, sanitizeResources: false, sanitizeOps: false, fn: async () => {
  await setup();
  try {
    const r = await turn(EVA, req("Ahoj."), { replies: ["Ahoj."] }, { production: true });
    eq(r.events, [{ event: "error", data: { code: "MAINTENANCE", retryable: false } }]);
    eq(await trialUsed(EVA), 0);
  } finally { await teardown(); }
}});

Deno.test({ name: "paywall: her message, the held message, no model call", ignore, sanitizeResources: false, sanitizeOps: false, fn: async () => {
  await setup();
  try {
    await sql`update public.usage_state set trial_used = 5 where user_id = ${EVA}`;
    const r = await turn(EVA, req("Ještě jedna otázka."), { replies: [] });
    eq(r.kinds, ["limit"]);
    const d: any = r.events[0].data;
    eq(d.code, "PAYWALL");
    ok(d.message.length > 20 && d.userMessageId);
    eq(r.ai.calls.length, 0);
    eq(await statusOf(d.userMessageId), "awaiting_entitlement");
  } finally { await teardown(); }
}});

Deno.test({ name: "memory reaches the prompt; planner failure falls back to the rule", ignore, sanitizeResources: false, sanitizeOps: false, fn: async () => {
  await setup();
  try {
    await sql`insert into public.memory_notes (user_id, category, key, content_enc)
      values (${EVA}, 'work', 'job', private.encrypt(${EVA}, 'Učí na základní škole.'))`;
    const r = await turn(EVA, req("Dneska mě zase naštvala kolegyně."), {
      planner: new ProviderError("unavailable", 503, "server_error"),
      replies: ["Evo, co přesně se stalo?"],
    });
    eq(r.kinds.at(-1), "done");
    const sent = r.ai.calls.find((c) => c.kind === "reply")!.messages!;
    eq(sent[1].role, "system");
    ok(sent[1].content.startsWith("=== O TOMTO ČLOVĚKU ==="));
    ok(sent[1].content.includes("Učí na základní škole."));
    const how = await sql`select mm.understanding ->> 'how' as how from public.message_meta mm where mm.user_id = ${EVA}`;
    eq(how[0].how, "fallback");
  } finally { await teardown(); }
}});
