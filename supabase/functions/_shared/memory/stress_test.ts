// Everything at once, on real connections: users chatting, three workers,
// the idle sweep, and users forgetting notes, clearing memory and withdrawing
// consent in the middle of it. Proves the things a unit test cannot:
//   * no deadlock and no unexpected database error under contention;
//   * a job is never worked on by two workers at the same time;
//   * memory written for one user contains only that user's material;
//   * after "forget everything" nothing comes back, whatever was in flight.
// Skipped when DATABASE_URL is not set.
import { deepStrictEqual, ok } from "node:assert";
import postgres from "npm:postgres@3";
import type { ChatEvent, ChatRequest } from "../chat/contract.ts";
import type { AI, CallOpts, ChatMessage } from "../chat/openai.ts";
import { type Db, DbError, runTurn } from "../chat/turn.ts";
import { runJobs } from "./worker.ts";

const DSN = Deno.env.get("DATABASE_URL");
const ignore = !DSN;
const USERS = 6;
const RUN_MS = Number(Deno.env.get("STRESS_MS") ?? 6000);
const uid = (i: number) => `00000000-0000-0000-0000-00000000a${String(i).padStart(3, "0")}`;
const marker = (i: number) => `ZNACKA${i}X`;

function pgDb(sql: postgres.Sql, errors: string[]): Db {
  const asService = <T>(f: (tx: postgres.TransactionSql) => Promise<T>) =>
    sql.begin(async (tx) => {
      await tx`set local role service_role`;
      return await f(tx);
    }) as Promise<T>;
  return {
    async rpc<T>(fn: string, args: Record<string, unknown>) {
      const keys = Object.keys(args);
      const call = `select public.${fn}(${keys.map((k, i) => `${k} => $${i + 1}`).join(", ")}) as r`;
      try {
        const rows = await asService((tx) => tx.unsafe(call, keys.map((k) => (args[k] === undefined ? null : args[k])) as any[]));
        return (rows as any)[0].r as T;
      } catch (e: any) {
        errors.push(`${fn}:${e.code ?? "unknown"}`);
        throw new DbError(e.code ?? "unknown", e.message);
      }
    },
    async config(keys: string[]) {
      const rows = await asService((tx) => tx`select key, value from public.app_config where key = any(${keys})`);
      return Object.fromEntries((rows as any[]).map((r: any) => [r.key, r.value]));
    },
  };
}

/** Echoes the user's marker back, so stored memory shows whose material it came from. */
class EchoAI implements AI {
  inFlight = new Map<string, number>();
  overlaps = 0;
  jobCalls = 0;
  async chat(messages: ChatMessage[], _o: CallOpts) {
    const sys = messages[0].content;
    const usage = { prompt_tokens: 300, completion_tokens: 30 };
    if (sys.startsWith("Posuzuješ jednu zprávu")) return { text: '{"level":"none"}', usage };
    const kind = sys.startsWith("Pojmenuj") ? "title" : sys.startsWith("Napiš shrnutí") ? "summary"
      : sys.startsWith("Vedeš krátké") ? "notes" : sys.startsWith("Z tohoto rozhovoru vyber") ? "moments" : "planner";
    if (kind === "planner") return { text: '{"mode":"PROZKOUMANI","vim":[],"chybi":"","otazka":""}', usage };
    this.jobCalls++;
    const body = messages[messages.length - 1].content;
    const marks = [...new Set(body.match(/ZNACKA\d+X/g) ?? [])];
    // Two workers on the same job would be here at the same time with the same input.
    const key = `${kind}:${body.length}:${marks.join(",")}:${body.slice(-80)}`;
    this.inFlight.set(key, (this.inFlight.get(key) ?? 0) + 1);
    if (this.inFlight.get(key)! > 1) this.overlaps++;
    await new Promise((r) => setTimeout(r, 3 + Math.random() * 12));
    this.inFlight.set(key, this.inFlight.get(key)! - 1);
    const who = marks.join(" ");
    if (kind === "title") return { text: JSON.stringify({ title: `Rozhovor ${who}` }), usage };
    if (kind === "summary") return { text: `Shrnutí rozhovoru, ve kterém zaznělo ${who}.`, usage };
    if (kind === "notes") {
      return { text: JSON.stringify({ upsert: [{ category: "work", key: "job", content: `Pracuje v oboru ${who}.` }], remove: [] }), usage };
    }
    return { text: JSON.stringify({ moments: [`Uvědomila si něco důležitého o ${who}.`] }), usage };
  }
  async *chatStream(_m: ChatMessage[], _o: CallOpts) {
    yield { delta: "Co se v tobě teď děje? " };
    yield { usage: { prompt_tokens: 1000, completion_tokens: 10 } };
  }
  embed(_t: string, _o: { model: string; dims: number }) {
    const vector = new Array(1024).fill(0);
    vector[3] = 1;
    return Promise.resolve({ vector, usage: { prompt_tokens: 8 } });
  }
}

Deno.test({ name: "memory under contention: no deadlock, no double work, no leak, forget wins", ignore, sanitizeOps: false, sanitizeResources: false }, async () => {
  const sql = postgres(DSN!, { max: 24, onnotice: () => {} });
  const errors: string[] = [];
  const db = pgDb(sql, errors);
  const ai = new EchoAI();
  const ids = Array.from({ length: USERS }, (_, i) => uid(i));
  const KEYS = ["memory.summary_every", "memory.moments_min_exchanges", "memory.idle_minutes", "limits.rate_per_minute", "limits.daily_soft_cap", "crisis.resources"];
  const saved = await sql`select key, value from public.app_config where key = any(${KEYS})`;
  const asUser = (user: string, q: string) =>
    sql.begin(async (tx) => {
      await tx`set local role authenticated`;
      await tx`select set_config('request.jwt.claims', ${JSON.stringify({ sub: user, role: "authenticated" })}, true)`;
      return await tx.unsafe(q);
    });
  const userErrors: string[] = [];

  try {
    await sql`delete from auth.users where id = any(${ids})`;
    for (let i = 0; i < USERS; i++) {
      await sql`insert into auth.users (id, email, raw_user_meta_data) values (${ids[i]}, ${`stress${i}@test.local`},
        ${sql.json({ profile: { displayName: "Eva", vocative: "Evo", dateOfBirth: "1990-01-01", gender: "female" }, consent: { accepted: true } })})`;
      await sql`insert into public.entitlements (user_id, active, plan) values (${ids[i]}, true, 'founding')
        on conflict (user_id) do update set active = true, period_ends_at = null`;
    }
    await sql`update public.app_config set value = '1' where key in ('memory.summary_every', 'memory.moments_min_exchanges')`;
    await sql`update public.app_config set value = '0' where key = 'memory.idle_minutes'`;
    await sql`update public.app_config set value = '100000' where key in ('limits.rate_per_minute', 'limits.daily_soft_cap')`;
    await sql`update public.app_config set value = '[]' where key = 'crisis.resources'`;
    await sql`update ops.jobs_queue set done_at = now() where done_at is null`;

    const until = Date.now() + RUN_MS;
    const running = () => Date.now() < until;
    const convs: (string | null)[] = ids.map(() => null);
    let turns = 0, clears = 0, forgets = 0;

    const chatter = async (i: number) => {
      while (running()) {
        const req: ChatRequest = { clientMsgId: crypto.randomUUID(), conversationId: convs[i], text: `Pracuju v oboru ${marker(i)} a chci změnu.`, inputMethod: "text", resumeMessageId: null, origin: "chat" };
        const events: ChatEvent[] = [];
        try {
          await runTurn({ db, ai, production: false }, ids[i], req, (e) => events.push(e));
          const acc = events.find((e) => e.event === "accepted") as any;
          if (acc) convs[i] = acc.data.conversationId;
          // A conversation cleared under us is expected; start a new one.
          if (!events.some((e) => e.event === "done")) convs[i] = null;
          else turns++;
        } catch {
          convs[i] = null;
        }
        await new Promise((r) => setTimeout(r, Math.random() * 20));
      }
    };
    const worker = async () => {
      while (running()) {
        await runJobs({ db, ai }, { budgetMs: 400, concurrency: 4 });
        await new Promise((r) => setTimeout(r, 5));
      }
    };
    const sweeper = async () => {
      while (running()) {
        try { await db.rpc("enqueue_idle_memory", { p_limit: 100 }); } catch { /* recorded in errors */ }
        await new Promise((r) => setTimeout(r, 15));
      }
    };
    // Users 0 and 1 keep clearing and forgetting while they chat.
    const forgetter = async (i: number) => {
      while (running()) {
        await new Promise((r) => setTimeout(r, 60 + Math.random() * 120));
        try {
          if (Math.random() < 0.5) {
            await asUser(ids[i], "select public.clear_memory()");
            convs[i] = null;
            clears++;
          } else {
            const rows = await sql`select id from public.memory_notes where user_id = ${ids[i]} limit 1`;
            if (rows.length) {
              await asUser(ids[i], `select public.forget_note('${rows[0].id}')`);
              forgets++;
            }
          }
        } catch (e: any) {
          if (e.code !== "P0002") userErrors.push(`forget:${e.code ?? e.message}`);
        }
      }
    };
    // User 2 withdraws AI consent halfway through.
    const withdrawer = async () => {
      await new Promise((r) => setTimeout(r, RUN_MS / 2));
      try {
        await asUser(ids[2], "select public.withdraw_consent(array['ai_processing']::public.consent_kind[])");
      } catch (e: any) {
        userErrors.push(`withdraw:${e.code ?? e.message}`);
      }
    };

    await Promise.all([
      ...ids.map((_, i) => chatter(i)),
      worker(), worker(), worker(), sweeper(),
      forgetter(0), forgetter(1), withdrawer(),
    ]);

    // What user 2 had at the moment the run stopped (after withdrawal) must not grow.
    const frozen = async () => (await sql`select
      (select count(*) from public.memory_notes where user_id = ${ids[2]})
      + (select count(*) from public.memory_embeddings where user_id = ${ids[2]}) as n,
      (select max(updated_at) from public.conversation_summaries where user_id = ${ids[2]}) as s`)[0];
    const before = await frozen();

    // Quiesce: users 0 and 1 forget everything one last time, then the queue is drained.
    await asUser(ids[0], "select public.clear_memory()");
    await asUser(ids[1], "select public.clear_memory()");
    await db.rpc("enqueue_idle_memory", { p_limit: 1000 });
    for (let k = 0; k < 20; k++) {
      const r = await runJobs({ db, ai }, { budgetMs: 2000, concurrency: 8 });
      if (r.claimed === 0) break;
    }

    // ---- invariants
    const bad = errors.filter((e) => !/:(P0002|P0001|42501|23505)$/.test(e) || e.includes("40P01"));
    deepStrictEqual(errors.filter((e) => e.endsWith(":40P01")), [], "no deadlock");
    deepStrictEqual(bad, [], "no unexpected database error");
    deepStrictEqual(userErrors, [], "forget, clear and withdraw never failed");
    deepStrictEqual(ai.overlaps, 0, "no job was worked on by two workers at once");

    for (const i of [0, 1]) {
      const [n] = await sql`select
        (select count(*) from public.memory_notes where user_id = ${ids[i]})
        + (select count(*) from public.conversation_summaries where user_id = ${ids[i]})
        + (select count(*) from public.memory_embeddings where user_id = ${ids[i]})
        + (select count(*) from ops.jobs_queue where user_id = ${ids[i]} and done_at is null) as n`;
      deepStrictEqual(Number(n.n), 0, `user ${i}: nothing came back after forget everything`);
    }
    const after = await frozen();
    deepStrictEqual([Number(after.n), String(after.s)], [Number(before.n), String(before.s)], "nothing was written after consent was withdrawn");
    deepStrictEqual(Number((await sql`select count(*) as n from ops.jobs_queue where user_id = ${ids[2]} and done_at is null`)[0].n), 0, "and no job is left open for that user");

    // Every stored piece of memory carries its owner's marker and nobody else's.
    const rows = await sql`
      select user_id, private.decrypt(user_id, content_enc) as t from public.memory_notes where user_id = any(${ids})
      union all select user_id, private.decrypt(user_id, summary_enc) from public.conversation_summaries where user_id = any(${ids})
      union all select user_id, private.decrypt(user_id, content_enc) from public.memory_embeddings where user_id = any(${ids})
      union all select user_id, private.decrypt(user_id, title_enc) from public.conversations where user_id = any(${ids}) and title_enc is not null`;
    ok(rows.length > 0, "memory was actually written during the run");
    for (const r of rows as any[]) {
      const own = marker(ids.indexOf(r.user_id));
      const found = [...new Set(String(r.t).match(/ZNACKA\d+X/g) ?? [])];
      deepStrictEqual(found, [own], `memory of ${r.user_id} holds only its owner's material`);
    }
    const dup = await sql`select user_id, key, count(*) from public.memory_notes where user_id = any(${ids}) group by 1, 2 having count(*) > 1`;
    deepStrictEqual(dup.length, 0, "one row per note key");
    ok(turns > USERS * 3 && ai.jobCalls > 20 && clears + forgets > 3, `the run was busy enough (turns ${turns}, job calls ${ai.jobCalls}, clears ${clears}, forgets ${forgets})`);
    // deno-lint-ignore no-console
    console.log(JSON.stringify({ stress: { turns, jobCalls: ai.jobCalls, clears, forgets, storedRows: rows.length } }));
  } finally {
    for (const r of saved) await sql`update public.app_config set value = ${sql.json(r.value as any)} where key = ${r.key}`;
    await sql`delete from auth.users where id = any(${ids})`;
    await sql.end();
  }
});

// ---------------------------------------------------------------- deterministic ordering

Deno.test({ name: "a forget or a consent withdrawal in progress makes a saving job wait, then refuses it", ignore, sanitizeOps: false, sanitizeResources: false }, async () => {
  const sql = postgres(DSN!, { max: 6, onnotice: () => {} });
  const U = "00000000-0000-0000-0000-00000000a900";
  const C = "40000000-0000-0000-0000-00000000a900";
  const asUserTx = async (tx: postgres.TransactionSql) => {
    await tx`set local role authenticated`;
    await tx`select set_config('request.jwt.claims', ${JSON.stringify({ sub: U, role: "authenticated" })}, true)`;
  };
  const notesResult = { throughAt: new Date().toISOString(), upsert: [{ category: "goal", key: "goal.main", content: "Chce učit jógu." }], remove: [] };
  /** A claimed notes job, as the worker would hold it. */
  const claimedJob = async () => {
    await sql`update ops.jobs_queue set done_at = now() where user_id = ${U} and done_at is null`;
    const [j] = await sql`insert into ops.jobs_queue (kind, user_id, payload, locked_at, lease, attempts)
      values ('notes', ${U}, ${sql.json({ conversation_id: C })}, now(), gen_random_uuid(), 1) returning id, lease`;
    return j as { id: number; lease: string };
  };
  const save = (j: { id: number; lease: string }) =>
    sql.begin(async (tx) => {
      await tx`set local role service_role`;
      return (await tx`select public.save_job_result(${j.id}, ${j.lease}, ${sql.json(notesResult)}) as r`)[0].r as string;
    });
  const settledWithin = async (p: Promise<unknown>, ms: number) =>
    await Promise.race([p.then(() => true), new Promise<boolean>((r) => setTimeout(() => r(false), ms))]);

  try {
    await sql`delete from auth.users where id = ${U}`;
    await sql`insert into auth.users (id, email, raw_user_meta_data) values (${U}, 'order@test.local',
      ${sql.json({ profile: { displayName: "Eva", vocative: "Evo", dateOfBirth: "1990-01-01" }, consent: { accepted: true } })})`;
    await sql`insert into public.conversations (id, user_id) values (${C}, ${U})`;
    await sql`insert into public.memory_notes (user_id, category, key, content_enc)
      values (${U}, 'goal', 'goal.main', private.encrypt(${U}, 'Chce učit jógu.'))`;
    const [note] = await sql`select id from public.memory_notes where user_id = ${U}`;

    // 1. The user forgets the note; before her transaction commits, a job tries to save the same fact.
    let job = await claimedJob();
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const forgetting = sql.begin(async (tx) => {
      await asUserTx(tx);
      await tx`select public.forget_note(${note.id})`;
      await gate; // transaction stays open
    });
    await new Promise((r) => setTimeout(r, 150));
    const saving = save(job);
    deepStrictEqual(await settledWithin(saving, 400), false, "the save waits for the forget in progress");
    release();
    await forgetting;
    deepStrictEqual(await saving, "stale", "and is refused once the forget has committed");
    deepStrictEqual((await sql`select count(*)::int as n from public.memory_notes where user_id = ${U}`)[0].n, 0, "the forgotten note did not come back");

    // 2. The same with a consent withdrawal.
    job = await claimedJob();
    const gate2 = new Promise<void>((r) => (release = r));
    const withdrawing = sql.begin(async (tx) => {
      await asUserTx(tx);
      await tx`select public.withdraw_consent(array['ai_processing']::public.consent_kind[])`;
      await gate2;
    });
    await new Promise((r) => setTimeout(r, 150));
    const saving2 = save(job);
    deepStrictEqual(await settledWithin(saving2, 400), false, "the save waits for the withdrawal in progress");
    release();
    await withdrawing;
    deepStrictEqual(await saving2, "stale", "and is refused once consent is withdrawn");
    deepStrictEqual((await sql`select count(*)::int as n from public.memory_notes where user_id = ${U}`)[0].n, 0, "nothing was written after the withdrawal");
    deepStrictEqual((await sql`select last_error from ops.jobs_queue where id = ${job.id}`)[0].last_error, "consent");
  } finally {
    await sql`delete from auth.users where id = ${U}`;
    await sql.end();
  }
});
