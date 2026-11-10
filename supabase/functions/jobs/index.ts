// POST /functions/v1/jobs -- the memory worker (titles, summaries, notes,
// moments). Called every minute by the database (ops.memory_tick) when the
// queue has work, never by the app.
//
// Deployed with JWT verification off (it is not a user endpoint); the caller
// must present the shared secret instead. Secrets: JOBS_SECRET (also stored in
// Vault as `jobs_secret`), OPENAI_API_KEY. SUPABASE_URL and
// SUPABASE_SERVICE_ROLE_KEY are provided by the platform.
import { createClient } from "npm:@supabase/supabase-js@2";
import { OpenAI } from "../_shared/chat/openai.ts";
import { supabaseDb } from "../_shared/chat/supabaseDb.ts";
import { log } from "../_shared/chat/log.ts";
import { runJobs } from "../_shared/memory/worker.ts";

const url = Deno.env.get("SUPABASE_URL")!;
const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const secret = Deno.env.get("JOBS_SECRET") ?? "";
const service = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
const db = supabaseDb(service);
const ai = new OpenAI(Deno.env.get("OPENAI_API_KEY") ?? "");

/** Constant-time comparison, so the secret cannot be guessed a byte at a time. */
async function same(a: string, b: string): Promise<boolean> {
  const enc = new TextEncoder();
  const [x, y] = await Promise.all([a, b].map((s) => crypto.subtle.digest("SHA-256", enc.encode(s))));
  const u = new Uint8Array(x), v = new Uint8Array(y);
  let diff = 0;
  for (let i = 0; i < u.length; i++) diff |= u[i] ^ v[i];
  return diff === 0;
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method !== "POST") return json(405, { code: "INVALID_INPUT" });
  // No secret configured means nobody may run the worker, not everybody.
  if (secret.length < 24 || !(await same(req.headers.get("x-jobs-secret") ?? "", secret))) {
    return json(401, { code: "UNAUTHENTICATED" });
  }
  const work = runJobs({ db, ai }).catch((e) => {
    log("jobs.crashed", { code: (e as { code?: string })?.code ?? "unknown" });
    return null;
  });
  // The database does not wait for the answer: reply now, finish in the background.
  // deno-lint-ignore no-explicit-any
  const rt = (globalThis as any).EdgeRuntime;
  if (rt?.waitUntil) {
    rt.waitUntil(work);
    return json(202, { accepted: true });
  }
  return json(200, (await work) ?? { code: "FAILED" });
});
