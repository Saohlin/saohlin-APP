// POST /functions/v1/notify -- emails new feedback messages (screen 48) to
// Claudia through Resend. Called by the database (ops.kick_notify) when a
// message arrives and every minute while one is unsent, never by the app.
//
// Deployed with JWT verification off; the caller presents the same shared
// secret as the `jobs` function. Secrets: JOBS_SECRET, RESEND_API_KEY, and
// optionally FEEDBACK_TO (default info@saohlin.com) and FEEDBACK_FROM.
//
// A message is leased, sent, then marked. A send that fails is tried again
// later by the database; Resend's idempotency key (the message id) keeps a
// retry of a send that did arrive from becoming a second email.
import { createClient } from "npm:@supabase/supabase-js@2";
import { log } from "../_shared/chat/log.ts";
import { buildEmail, type FeedbackRow } from "../_shared/feedback/email.ts";

const url = Deno.env.get("SUPABASE_URL")!;
const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const secret = Deno.env.get("JOBS_SECRET") ?? "";
const resendKey = Deno.env.get("RESEND_API_KEY") ?? "";
const to = Deno.env.get("FEEDBACK_TO") ?? "info@saohlin.com";
const from = Deno.env.get("FEEDBACK_FROM") ?? "SAOHLIN <feedback@saohlin.com>";
const service = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

/** Messages per claim, and claims per call: at most 50 emails a call. */
const BATCH = 10;
const ROUNDS = 5;

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

/** Sends one email. Returns null when Resend took it, else a short code (never the text). */
async function send(row: FeedbackRow): Promise<string | null> {
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${resendKey}`,
        "Content-Type": "application/json",
        "Idempotency-Key": `feedback-${row.id}`,
      },
      body: JSON.stringify(buildEmail(row, { from, to })),
      signal: AbortSignal.timeout(10_000),
    });
    await res.body?.cancel();
    return res.ok ? null : `resend_${res.status}`;
  } catch (e) {
    return (e as { name?: string })?.name === "TimeoutError" ? "resend_timeout" : "resend_unreachable";
  }
}

async function run(): Promise<{ sent: number; failed: number }> {
  let sent = 0, failed = 0;
  for (let round = 0; round < ROUNDS; round++) {
    const { data, error } = await service.rpc("claim_feedback", { p_limit: BATCH });
    if (error) {
      log("notify.claim_failed", { code: error.code ?? "unknown" });
      break;
    }
    const rows = (data ?? []) as FeedbackRow[];
    if (rows.length === 0) break;
    for (const row of rows) {
      const fault = await send(row);
      const { error: markError } = await service.rpc("feedback_notified", {
        p_id: row.id,
        p_lease: row.lease,
        p_ok: fault === null,
        p_error: fault,
      });
      if (fault === null) sent++;
      else failed++;
      log("notify.feedback", { id: row.id, ok: fault === null, code: fault ?? markError?.code ?? null });
    }
    if (rows.length < BATCH) break;
  }
  return { sent, failed };
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json(405, { code: "INVALID_INPUT" });
  // No secret configured means nobody may run this, not everybody.
  if (secret.length < 24 || !(await same(req.headers.get("x-jobs-secret") ?? "", secret))) {
    return json(401, { code: "UNAUTHENTICATED" });
  }
  // Without a key nothing is claimed, so no message uses up its tries while the key is missing.
  if (!resendKey) {
    log("notify.no_key");
    return json(503, { code: "NOT_CONFIGURED" });
  }
  const work = run().catch((e) => {
    log("notify.crashed", { code: (e as { code?: string })?.code ?? "unknown" });
    return null;
  });
  // deno-lint-ignore no-explicit-any
  const rt = (globalThis as any).EdgeRuntime;
  if (rt?.waitUntil) {
    rt.waitUntil(work);
    return json(202, { accepted: true });
  }
  return json(200, (await work) ?? { code: "FAILED" });
});
