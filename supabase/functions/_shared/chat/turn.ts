// One chat turn, end to end (Chat Module Spec, Server pipeline; SUPABASE_IMPLEMENTATION 10.2).
//
//   start_turn (gate + save + context, one DB call)  -> accepted
//   in parallel: keyword screen, planner, crisis classifier, embedding -> retrieve_all
//   build the prompt, stream the reply through the sentence gate  -> delta ...
//   one corrective continuation if a sentence fails
//   finish_turn (reply, meta, retrievals, jobs)  -> done
//
// Everything outside is injected (database, model, clock) so the whole turn
// runs in tests against the real schema and a scripted model.
import type { ChatEvent, ChatRequest, CrisisResource, ErrorCode } from "./contract.ts";
import { type AI, type ChatMessage, ProviderError, type Usage } from "./openai.ts";
import { log } from "./log.ts";
import { budget, enforceUnderstanding, plan as planTurn, type Plan, type Turn } from "../pipeline/modes.ts";
import { buildMessages, type KbItem, Library, type Person, type Pools, type StaticKb } from "../pipeline/prompt.ts";
import { continuationMessages, finalChecks, LeakIndex, SentenceGate, splitSentences } from "../pipeline/gate.ts";
import { classifierMessages, type CrisisLevel, forcesBoundary, keywordScreen, maxLevel, parseClassifier } from "../pipeline/crisis.ts";
import { maxLimits, retrievalQuery } from "../pipeline/query.ts";
import { search, split, unaccent, words } from "../pipeline/pyre.ts";
import type { StyleRules } from "../pipeline/checks.ts";

export class DbError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
  }
}
export interface Db {
  rpc<T = unknown>(fn: string, args: Record<string, unknown>): Promise<T>;
  config(keys: string[]): Promise<Record<string, unknown>>;
}
export interface Deps {
  db: Db;
  ai: AI;
  production: boolean;
  now?: () => number;
  timeouts?: { firstDeltaMs?: number; plannerMs?: number; classifierMs?: number; embedMs?: number };
}

// ---------------------------------------------------------------- knowledge cache

export interface Kb {
  version: string;
  lib: Library;
  leak: LeakIndex;
  identity: string;
  rules: StyleRules;
  loadedAt: number;
}
let kbCache: Kb | null = null;
const KB_TTL_MS = 10 * 60 * 1000;

export function kbFromStatic(s: any, now: number): Kb {
  const coll = (name: string): KbItem[] => (s.collections?.[name] ?? []) as KbItem[];
  const rules = s.checkRules?.rules?.style_rules as StyleRules;
  const staticKb: StaticKb = {
    styleCard: s.persona.styleCard,
    styles: coll("style_source"),
    guidePrinciples: coll("guide_principle"),
    framework: coll("framework"),
    guideMap: coll("guide_map"),
    styleRules: rules,
  };
  const lib = new Library(staticKb);
  const leak = new LeakIndex([s.persona.styleCard, ...lib.alwaysRules().map((r) => r.text)]);
  return { version: s.persona.version, lib, leak, identity: s.persona.identitySentence, rules, loadedAt: now };
}

async function loadKb(db: Db, now: number): Promise<Kb> {
  if (kbCache && now - kbCache.loadedAt < KB_TTL_MS) return kbCache;
  const s = await db.rpc<any>("get_kb_static", {});
  if (!s?.persona) throw new DbError("KB_EMPTY", "knowledge base not loaded");
  kbCache = kbFromStatic(s, now);
  return kbCache;
}
export function resetKbCache() {
  kbCache = null;
}

// ---------------------------------------------------------------- helpers

const CONFIG_KEYS = [
  "chat.limit_messages", "crisis.patterns", "crisis.resources",
  "model.reply", "model.reply_degraded", "model.planner", "model.embedding",
  "model.params", "model.prices", "chat.temperature", "chat.max_tokens_per_word", "memory.search_limit",
];

// "what I told you last time" -- the only turns that search layer 4.
const PAST_REFERENCE = "(minule|posledne|tehdy|predtim|uz jsem ti|jak jsem (ti )?(psal|rikal)|pamatujes|to, co jsem|pred (par|nekolika) (dny|tydny|mesici))";

function openingOf(text: string, n = 7): string {
  const first = split("(?<=[.!?])\\s", text.trim(), 1)[0];
  return words(first).slice(0, n).join(" ");
}

function genderOf(g: unknown): "f" | "m" | null {
  return g === "female" ? "f" : g === "male" ? "m" : null;
}

function withTimeout<T>(ms: number, f: (s: AbortSignal) => Promise<T>): Promise<T> {
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), ms);
  return f(c.signal).finally(() => clearTimeout(t));
}

function cost(prices: any, model: string, u: Usage): number {
  const p = prices?.[model];
  if (!p) return 0;
  const cached = u.prompt_tokens_details?.cached_tokens ?? 0;
  const input = (u.prompt_tokens ?? 0) - cached;
  return (input * (p.in ?? 0) + cached * (p.cached ?? p.in ?? 0) + (u.completion_tokens ?? 0) * (p.out ?? 0)) / 1e6;
}

interface Call { purpose: string; model: string; usage?: Usage; ok: boolean; errorCode?: string; durationMs: number }

// ---------------------------------------------------------------- the turn

export async function runTurn(deps: Deps, userId: string, req: ChatRequest, emit: (e: ChatEvent) => void): Promise<void> {
  const now = deps.now ?? (() => Date.now());
  const t0 = now();
  const timings: Record<string, number> = {};
  const mark = (k: string) => (timings[k] = now() - t0);
  const calls: Call[] = [];
  const to = { firstDeltaMs: 20000, plannerMs: 8000, classifierMs: 8000, embedMs: 8000, ...(deps.timeouts ?? {}) };

  const cfg = await deps.db.config(CONFIG_KEYS);
  const resources = (cfg["crisis.resources"] ?? []) as CrisisResource[];
  if (deps.production && resources.length === 0) {
    // Numbers not confirmed by Claudia and the lawyer: production refuses to chat (Q2).
    log("chat.refused", { reason: "crisis_resources_missing" });
    emit({ event: "error", data: { code: "MAINTENANCE", retryable: false } });
    return;
  }

  // 1. The gate, the stored message and the context -----------------------------
  let st: any;
  try {
    st = await deps.db.rpc("start_turn", {
      p_user: userId, p_client_msg_id: req.clientMsgId, p_text: req.resumeMessageId ? null : req.text,
      p_conversation_id: req.conversationId, p_input_method: req.inputMethod,
      p_resume_message_id: req.resumeMessageId, p_origin: req.origin ?? "chat",
    });
  } catch (e) {
    const code: ErrorCode = e instanceof DbError && e.code === "22023" ? "INVALID_INPUT"
      : e instanceof DbError && e.code === "P0002" ? "NOT_FOUND" : "AI_UNAVAILABLE";
    log("chat.start_failed", { code, db: e instanceof DbError ? e.code : "unknown" });
    emit({ event: "error", data: { code, retryable: code === "AI_UNAVAILABLE" } });
    return;
  }
  mark("start_turn");

  if (st.kind === "limit") {
    const messages = (cfg["chat.limit_messages"] ?? {}) as Record<string, string>;
    emit({
      event: "limit",
      data: {
        code: st.code, message: messages[st.code] ?? "",
        ...(st.retryAfterSeconds ? { retryAfterSeconds: st.retryAfterSeconds } : {}),
        ...(st.conversationId ? { conversationId: st.conversationId, userMessageId: st.userMessageId } : {}),
      },
    });
    log("chat.limit", { code: st.code, user: userId });
    return;
  }

  emit({
    event: "accepted",
    data: { conversationId: st.conversationId, userMessageId: st.userMessageId, trialRemaining: st.trialRemaining ?? null, degraded: !!st.degraded },
  });

  if (st.kind === "replay") {
    for (const s of splitSentences(st.reply)) emit({ event: "delta", data: { text: s } });
    emit({ event: "done", data: { assistantMessageId: st.assistantMessageId, mode: st.mode } });
    log("chat.replay", { user: userId, message: st.userMessageId });
    return;
  }

  const userMessageId: string = st.userMessageId;
  const fail = async (code: ErrorCode, retryable: boolean, detail: string) => {
    try {
      await deps.db.rpc("fail_turn", { p_user: userId, p_user_message_id: userMessageId });
    } catch { /* the message stays pending; a retry treats it the same way */ }
    await logCalls(deps, userId, userMessageId, calls, cfg);
    log("chat.failed", { code, detail, user: userId, message: userMessageId, ms: now() - t0 });
    emit({ event: "error", data: { code, retryable } });
  };

  try {
    // 2. Context -------------------------------------------------------------------
    const ctx = st.context;
    const userMsg: string = ctx.message;
    const history: Turn[] = (ctx.history ?? []).map((h: any) => ({ role: h.role, content: h.text ?? "" }));
    const profile = ctx.profile ?? {};
    const gender = genderOf(profile.gender);
    const person: Person = {
      name: profile.displayName ?? null, vocative: profile.vocative ?? null, gender, zodiac: profile.zodiac ?? null,
      context: ctx.context ?? {}, notes: ctx.notes ?? [], summary: ctx.summary ?? null,
      recentConversations: ctx.recentConversations ?? [],
    };
    const kb = await loadKb(deps.db, t0);

    const temps = (cfg["chat.temperature"] ?? {}) as Record<string, number | null>;
    const params = (cfg["model.params"] ?? {}) as Record<string, Record<string, unknown>>;
    const withTemp = (model: string, t: number | null | undefined) =>
      ({ ...(t === null || t === undefined ? {} : { temperature: t }), ...(params[model] ?? {}) });
    const plannerModel = String(cfg["model.planner"]);
    const replyModel = String(st.degraded ? cfg["model.reply_degraded"] : cfg["model.reply"]);

    const timed = async <T>(purpose: string, model: string, f: () => Promise<{ usage?: Usage } & T>) => {
      const s = now();
      try {
        const r = await f();
        calls.push({ purpose, model, usage: r.usage, ok: true, durationMs: now() - s });
        return r;
      } catch (e) {
        calls.push({ purpose, model, ok: false, errorCode: e instanceof ProviderError ? e.code : "error", durationMs: now() - s });
        throw e;
      }
    };

    // 3. In parallel: crisis, plan, retrieval -----------------------------------------
    const keyword = keywordScreen(userMsg, (cfg["crisis.patterns"] ?? []) as string[]);
    const priorUserTurns = history.filter((h) => h.role === "user").map((h) => h.content);

    const planP = planTurn(userMsg, history, async (messages) => {
      const r = await timed("planner", plannerModel, () =>
        withTimeout(to.plannerMs, (signal) =>
          deps.ai.chat(messages, { model: plannerModel, params: withTemp(plannerModel, temps.planner ?? 0), signal, json: true })));
      return r.text;
    }).then((p) => (mark("planner"), p));

    const classP: Promise<CrisisLevel> = timed("crisis", plannerModel, () =>
      withTimeout(to.classifierMs, (signal) =>
        deps.ai.chat(classifierMessages(userMsg, priorUserTurns), {
          model: plannerModel, params: withTemp(plannerModel, 0), signal, json: true,
        })))
      .then((r) => parseClassifier(r.text))
      .catch(() => "low" as CrisisLevel)
      .then((l) => (mark("classifier"), l));

    const embModel = String(cfg["model.embedding"] ?? "text-embedding-3-large");
    const query = retrievalQuery(userMsg, ctx.previousUserText);
    const pastRef = search(PAST_REFERENCE, unaccent(userMsg.toLowerCase())) !== null;
    const poolsP: Promise<Pools> = timed("embedding", embModel, () =>
      withTimeout(to.embedMs, (signal) => deps.ai.embed(query, { model: embModel, dims: 1024, signal })))
      .then((e) => (mark("embed"), deps.db.rpc<Pools>("retrieve_all", {
        p_user: userId, q_embedding: JSON.stringify(e.vector), q_text: query,
        p_limits: maxLimits(), p_guide: null, p_pinned: ["PROTOKOL.pdf"],
        p_memory: pastRef ? Number(cfg["memory.search_limit"] ?? 3) : 0,
      })))
      .then((p) => (mark("retrieve"), p));

    const [planned, classLevel, pools] = await Promise.all([planP, classP, poolsP]);

    // 4. Decide the shape ------------------------------------------------------------------
    let p: Plan = enforceUnderstanding(planned, history, userMsg);
    const level = maxLevel(keyword, classLevel);
    if (forcesBoundary(level)) p = { ...p, mode: "HRANICE", how: `${p.how}+crisis` };
    const [lo, hi] = budget(p);
    const recent = history.filter((h) => h.role === "assistant").map((h) => openingOf(h.content)).filter(Boolean);

    const { messages, used } = buildMessages({
      lib: kb.lib, userMsg, person, history, plan: p, pools, recent,
      crisis: { level, resources },
    });

    // 5. Generate through the sentence gate --------------------------------------------
    const gate = new SentenceGate({ rules: kb.rules, mode: p.mode, gender, leak: kb.leak, allowedVerbatim: [kb.identity] });
    const perWord = Number(cfg["chat.max_tokens_per_word"] ?? 3);
    const maxTokens = Math.ceil(hi * 1.3 * perWord) + 64;
    const hardFailures: string[] = [];
    let released = 0;
    let firstDelta = false;

    const attempt = async (msgs: ChatMessage[], purpose: string) => {
      const controller = new AbortController();
      const deadline = firstDelta ? null : setTimeout(() => controller.abort(), to.firstDeltaMs);
      const s = now();
      let usage: Usage | undefined;
      let stopped = false;
      let firstToken = false;
      try {
        for await (const chunk of deps.ai.chatStream(msgs, {
          model: replyModel, params: withTemp(replyModel, temps.reply ?? 0.7), maxTokens, signal: controller.signal,
        })) {
          if (chunk.usage) usage = chunk.usage;
          if (!chunk.delta || stopped) continue;
          if (!firstToken) { firstToken = true; if (!timings.first_token) mark("first_token"); }
          const r = gate.push(chunk.delta);
          for (const text of r.release) {
            if (!firstDelta) { firstDelta = true; mark("first_delta"); if (deadline) clearTimeout(deadline); }
            emit({ event: "delta", data: { text } });
            released++;
          }
          if (r.stop) { stopped = true; controller.abort(); }
        }
        if (!stopped) {
          const r = gate.flush();
          for (const text of r.release) {
            if (!firstDelta) { firstDelta = true; mark("first_delta"); if (deadline) clearTimeout(deadline); }
            emit({ event: "delta", data: { text } });
            released++;
          }
          stopped = r.stop;
        }
        calls.push({ purpose, model: replyModel, usage, ok: true, durationMs: now() - s });
      } catch (e) {
        if (deadline) clearTimeout(deadline);
        if (stopped && e instanceof ProviderError && e.kind === "timeout") {
          // our own abort after a failed sentence
          calls.push({ purpose, model: replyModel, usage, ok: true, durationMs: now() - s });
        } else {
          calls.push({ purpose, model: replyModel, ok: false, errorCode: e instanceof ProviderError ? e.code : "error", durationMs: now() - s });
          throw e;
        }
      } finally {
        if (deadline) clearTimeout(deadline);
      }
      return stopped;
    };

    let retried = false;
    let interrupted = false;
    try {
      if (await attempt(messages, "reply")) {
        const first = gate.failed;
        hardFailures.push(...first.map((f) => f.rule));
        retried = true;
        gate.failed = [];
        const cont = continuationMessages(messages, gate.text, first, { vocativeForm: person.vocative, gender });
        if (await attempt(cont, "retry")) hardFailures.push(...gate.failed.map((f) => f.rule));
      }
    } catch (e) {
      if (released === 0) throw e;
      interrupted = true; // provider failed mid-reply: keep the complete sentences already shown
      hardFailures.push("stream_interrupted");
    }

    const reply = gate.text.trim();
    if (!reply) {
      await fail("AI_UNAVAILABLE", true, "no_passing_sentence");
      return;
    }
    mark("generated");

    // 6. Whole-reply checks (logged; the text is already on screen) -------------------
    const final = finalChecks(reply, kb.rules, { mode: p.mode, budget: [lo, hi], name: person.name, vocativeForm: person.vocative, gender });
    hardFailures.push(...final.map((f) => f.rule));

    // 7. Store --------------------------------------------------------------------------
    const retrievals = [
      ...used.knowledge.map((c, i) => ({ collection: "knowledge", itemId: c.id, score: c.score ?? null, slot: i })),
      ...used.videos.map((c, i) => ({ collection: "video", itemId: c.id, score: c.score ?? null, slot: i })),
      ...used.guides.map((c, i) => ({ collection: "guide", itemId: c.id, score: c.score ?? null, slot: i })),
      ...used.clients.map((c, i) => ({ collection: "realclient", itemId: c.id, score: c.score ?? null, slot: i })),
      ...used.principles.map((c, i) => ({ collection: "principle", itemId: c.id, score: null, slot: i })),
      ...used.framework.map((c, i) => ({ collection: "framework", itemId: c.id, score: null, slot: i })),
      ...used.guideMap.map((c, i) => ({ collection: "guide_map", itemId: c.id, score: null, slot: i })),
      ...used.exemplars.map((e, i) => ({ collection: "exemplar", itemId: e.id, score: e.score ?? null, slot: i })),
      ...(pools.memory ?? []).map((m: any, i: number) => ({ collection: "memory", itemId: m.id, score: m.score ?? null, slot: i })),
    ];
    const replyCalls = calls.filter((c) => c.purpose === "reply" || c.purpose === "retry");
    const sum = (f: (u: Usage) => number) => replyCalls.reduce((a, c) => a + (c.usage ? f(c.usage) : 0), 0);
    const acute = level === "acute" && resources.length > 0;
    const fin = await deps.db.rpc<any>("finish_turn", {
      p_user: userId, p_user_message_id: userMessageId, p_reply: reply, p_mode: p.mode,
      p_meta: {
        model: replyModel, plannerHow: plannerHowOf(p.how),
        understanding: { vim: p.vim ?? [], missing: p.chybi_ctyri ?? [], how: p.how, persona: kb.version, crisis: level },
        tokensIn: sum((u) => u.prompt_tokens ?? 0), tokensCached: sum((u) => u.prompt_tokens_details?.cached_tokens ?? 0),
        tokensOut: sum((u) => u.completion_tokens ?? 0),
        costEur: replyCalls.reduce((a, c) => a + (c.usage ? cost(cfg["model.prices"], c.model, c.usage) : 0), 0),
        timings, hardFailures: [...new Set(hardFailures)], retried, degraded: !!st.degraded || interrupted,
        crisisFlag: forcesBoundary(level),
      },
      p_retrievals: retrievals,
      p_crisis_card: acute,
    });
    mark("done");
    if (acute) emit({ event: "crisis", data: { resources } });
    emit({ event: "done", data: { assistantMessageId: fin.assistantMessageId, mode: p.mode } });
    await logCalls(deps, userId, userMessageId, calls, cfg);
    log("chat.done", {
      user: userId, message: userMessageId, mode: p.mode, how: plannerHowOf(p.how), retried, crisis: forcesBoundary(level),
      first_delta_ms: timings.first_delta, total_ms: timings.done, failures: hardFailures.length,
    });
  } catch (e) {
    if (e instanceof ProviderError) {
      if (e.kind === "credit_exhausted") {
        log("alert.credit_exhausted", { user: userId });
        await fail("CREDIT_EXHAUSTED", false, e.code);
      } else {
        await fail("AI_UNAVAILABLE", e.kind !== "auth" && e.kind !== "bad_request", e.code);
      }
      return;
    }
    log("chat.error", { user: userId, message: userMessageId, kind: (e as Error)?.name ?? "error" });
    await fail("AI_UNAVAILABLE", true, "internal");
  }
}

function plannerHowOf(how: string): string {
  if (how.includes("crisis")) return "crisis";
  if (how.startsWith("rule")) return "deterministic";
  if (how.startsWith("planner")) return how.includes("+") ? "enforced" : "planner";
  return how.includes("+") ? "enforced" : "fallback";
}

async function logCalls(deps: Deps, userId: string, messageId: string, calls: Call[], cfg: Record<string, unknown>) {
  if (!calls.length) return;
  try {
    await deps.db.rpc("log_ai_calls", {
      p_user: userId, p_message_id: messageId,
      p_calls: calls.map((c) => ({
        purpose: c.purpose, model: c.model, tokensIn: c.usage?.prompt_tokens ?? null,
        tokensCached: c.usage?.prompt_tokens_details?.cached_tokens ?? null, tokensOut: c.usage?.completion_tokens ?? null,
        costEur: c.usage ? cost(cfg["model.prices"], c.model, c.usage) : 0, durationMs: c.durationMs, ok: c.ok,
        errorCode: c.errorCode ?? null,
      })),
    });
  } catch {
    log("chat.cost_log_failed", { user: userId });
  }
}
