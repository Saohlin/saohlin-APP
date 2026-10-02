// The memory worker: turns queued ids into a title, a summary, notes and
// moments. Runs after the reply, never in its path.
//
// Safe to run in parallel with itself: jobs are leased in the database
// (claim_jobs), and every write re-checks inside one transaction that the job
// is still wanted (save_job_result), so "forget" always wins over a job that
// was already running.
//
// Logs carry ids, kinds, counts and codes. Never text.
import { type AI, type ChatMessage, ProviderError, type Usage } from "../chat/openai.ts";
import { type Db, DbError } from "../chat/turn.ts";
import { log } from "../chat/log.ts";
import {
  type JobMessage, momentsPrompt, type Note, notesPrompt, parseMoments, parseNotes, parseSummary, parseTitle,
  summaryPrompt, titlePrompt,
} from "./prompts.ts";

export interface WorkerDeps { db: Db; ai: AI; now?: () => number }
export interface WorkerOpts {
  /** Stop claiming new jobs after this long. A run always finishes the jobs it holds. */
  budgetMs?: number;
  /** Jobs in flight at once in this run. */
  concurrency?: number;
  /** One model call may take this long. */
  callTimeoutMs?: number;
}
export interface WorkerResult { claimed: number; saved: number; skipped: number; stale: number; failed: number; stopped: string | null }

interface Job { id: number; kind: string; lease: string }
interface Call { purpose: string; model: string; tokensIn: number | null; tokensCached: number | null; tokensOut: number | null; costEur: number; durationMs: number; ok: boolean; errorCode: string | null }
interface Ctx {
  skip?: string; kind?: string; userId?: string; conversationId?: string; gender?: string | null;
  messages?: JobMessage[]; notes?: Note[]; throughAt?: string; throughMessageId?: string; messageCount?: number; occurredAt?: string;
}

const CONFIG_KEYS = ["model.jobs", "model.embedding", "model.params", "model.prices", "memory.moments_per_conversation"];
const MAX_TOKENS: Record<string, number> = { title: 300, summary: 1800, notes: 2400, moments: 1000 };
const PURPOSE: Record<string, string> = { title: "title", summary: "summary", notes: "memory", moments: "memory" };

// deno-lint-ignore no-explicit-any
function cost(prices: any, model: string, u: Usage): number {
  const p = prices?.[model];
  if (!p) return 0;
  const cached = u.prompt_tokens_details?.cached_tokens ?? 0;
  const input = (u.prompt_tokens ?? 0) - cached;
  return (input * (p.in ?? 0) + cached * (p.cached ?? p.in ?? 0) + (u.completion_tokens ?? 0) * (p.out ?? 0)) / 1e6;
}

/** A failure that says the whole run should stop, not just this job. */
function stopsRun(e: unknown): string | null {
  if (e instanceof ProviderError && (e.kind === "credit_exhausted" || e.kind === "auth")) return e.kind;
  return null;
}

export async function runJobs(deps: WorkerDeps, opts: WorkerOpts = {}): Promise<WorkerResult> {
  const now = deps.now ?? Date.now;
  const started = now();
  const budget = opts.budgetMs ?? 45_000;
  const concurrency = Math.max(1, Math.min(opts.concurrency ?? 4, 16));
  const callTimeout = opts.callTimeoutMs ?? 30_000;
  const res: WorkerResult = { claimed: 0, saved: 0, skipped: 0, stale: 0, failed: 0, stopped: null };

  const cfg = await deps.db.config(CONFIG_KEYS);
  const model = String(cfg["model.jobs"] ?? "gpt-5.6-luna");
  const embModel = String(cfg["model.embedding"] ?? "text-embedding-3-large");
  const params = ((cfg["model.params"] ?? {}) as Record<string, Record<string, unknown>>)[model] ?? {};
  const prices = cfg["model.prices"];
  const maxMoments = Number(cfg["memory.moments_per_conversation"] ?? 3);

  const timed = async <T extends { usage: Usage }>(calls: Call[], purpose: string, m: string, f: (signal: AbortSignal) => Promise<T>): Promise<T> => {
    const t0 = now();
    const c = new AbortController();
    const timer = setTimeout(() => c.abort(), callTimeout);
    try {
      const out = await f(c.signal);
      calls.push({
        purpose, model: m, tokensIn: out.usage.prompt_tokens ?? null,
        tokensCached: out.usage.prompt_tokens_details?.cached_tokens ?? null, tokensOut: out.usage.completion_tokens ?? null,
        costEur: cost(prices, m, out.usage), durationMs: now() - t0, ok: true, errorCode: null,
      });
      return out;
    } catch (e) {
      calls.push({
        purpose, model: m, tokensIn: null, tokensCached: null, tokensOut: null, costEur: 0, durationMs: now() - t0, ok: false,
        errorCode: e instanceof ProviderError ? e.code : "error",
      });
      throw e;
    } finally {
      clearTimeout(timer);
    }
  };

  const ask = (calls: Call[], kind: string, messages: ChatMessage[], json: boolean) =>
    timed(calls, PURPOSE[kind], model, (signal) => deps.ai.chat(messages, { model, params, maxTokens: MAX_TOKENS[kind], signal, json }));

  async function one(job: Job): Promise<void> {
    const calls: Call[] = [];
    try {
      const ctx = await deps.db.rpc<Ctx>("job_context", { p_job: job.id, p_lease: job.lease });
      if (ctx.skip) {
        res.skipped++;
        return;
      }
      const msgs = ctx.messages ?? [];
      let result: Record<string, unknown> | null = null;

      if (job.kind === "title") {
        const title = parseTitle((await ask(calls, "title", titlePrompt(msgs, ctx.gender), true)).text);
        // No usable title is a finished job, not a retry: the conversation keeps its date.
        result = { title: title ?? "" };
      } else if (job.kind === "summary") {
        const summary = parseSummary((await ask(calls, "summary", summaryPrompt(msgs, ctx.gender), false)).text);
        if (summary) result = { summary, throughMessageId: ctx.throughMessageId, messageCount: ctx.messageCount, model };
      } else if (job.kind === "notes") {
        const parsed = parseNotes((await ask(calls, "notes", notesPrompt(msgs, ctx.notes ?? [], ctx.gender), true)).text, ctx.notes ?? []);
        if (parsed) result = { ...parsed, throughAt: ctx.throughAt };
      } else if (job.kind === "moments") {
        const texts = parseMoments((await ask(calls, "moments", momentsPrompt(msgs, ctx.gender), true)).text, maxMoments);
        if (texts) {
          const moments: { content: string; embedding: string }[] = [];
          for (const content of texts) {
            const e = await timed(calls, "embedding", embModel, (signal) => deps.ai.embed(content, { model: embModel, dims: 1024, signal }));
            moments.push({ content, embedding: JSON.stringify(e.vector) });
          }
          result = { moments, occurredAt: ctx.occurredAt };
        }
      }

      if (!result) {
        await deps.db.rpc("fail_job", { p_job: job.id, p_lease: job.lease, p_error: "bad_output", p_retry: true, p_count: true, p_calls: calls });
        res.failed++;
        log("jobs.bad_output", { job: job.id, kind: job.kind });
        return;
      }
      const outcome = await deps.db.rpc<string>("save_job_result", { p_job: job.id, p_lease: job.lease, p_result: result, p_calls: calls });
      if (outcome === "saved") res.saved++;
      else res.stale++;
    } catch (e) {
      res.failed++;
      const stop = stopsRun(e);
      if (stop) res.stopped = stop;
      const code = e instanceof ProviderError ? `${e.kind}:${e.code}` : e instanceof DbError ? `db:${e.code}` : "error";
      // A bad request cannot succeed by waiting. A provider that is down, rate
      // limited or out of credit is not the job's fault: it waits without
      // using up a try, so an outage never throws memory away.
      const retry = !(e instanceof ProviderError && e.kind === "bad_request");
      const count = !(e instanceof ProviderError);
      log("jobs.failed", { job: job.id, kind: job.kind, code: code.slice(0, 64) });
      try {
        await deps.db.rpc("fail_job", { p_job: job.id, p_lease: job.lease, p_error: code, p_retry: retry, p_count: count, p_calls: calls });
      } catch {
        // The lease expires on its own and the job is claimed again.
      }
    }
  }

  // A small pool: keep `concurrency` jobs in flight, claiming more as slots free up.
  const inFlight = new Set<Promise<void>>();
  let drained = false;
  while (!drained || inFlight.size) {
    while (!drained && !res.stopped && inFlight.size < concurrency && now() - started < budget) {
      const want = concurrency - inFlight.size;
      let jobs: Job[] = [];
      try {
        jobs = await deps.db.rpc<Job[]>("claim_jobs", { p_limit: want });
      } catch (e) {
        // Stop claiming, but finish what is already in flight.
        res.stopped = e instanceof DbError ? `db:${e.code}`.slice(0, 64) : "claim_failed";
        log("jobs.claim_failed", { code: res.stopped });
      }
      if (!jobs?.length) {
        drained = true;
        break;
      }
      res.claimed += jobs.length;
      for (const j of jobs) {
        const p: Promise<void> = one(j).finally(() => inFlight.delete(p));
        inFlight.add(p);
      }
    }
    if (res.stopped || now() - started >= budget) drained = true;
    if (inFlight.size) await Promise.race(inFlight);
  }

  log("jobs.run", { claimed: res.claimed, saved: res.saved, skipped: res.skipped, stale: res.stale, failed: res.failed, stopped: res.stopped, ms: now() - started });
  return res;
}
