// POST /functions/v1/chat -- the only way a message is ever written.
//
// Verifies the user's token, validates the body, then streams one turn as
// Server-Sent Events (see _shared/chat/contract.ts). The user id comes only
// from the verified token. If the phone disconnects mid-reply the turn still
// completes and is stored, so reopening the conversation (or retrying with the
// same clientMsgId) shows it without counting again.
//
// Secrets: OPENAI_API_KEY (restricted to model calls, separate dev and prod
// keys with a hard monthly cap). SAOHLIN_ENV=production enables the
// crisis-resources assertion. SUPABASE_URL, SUPABASE_ANON_KEY and
// SUPABASE_SERVICE_ROLE_KEY are provided by the platform.
import { createClient } from "npm:@supabase/supabase-js@2";
import { InvalidInput, parseRequest, sse, type ChatEvent } from "../_shared/chat/contract.ts";
import { OpenAI } from "../_shared/chat/openai.ts";
import { runTurn } from "../_shared/chat/turn.ts";
import { supabaseDb } from "../_shared/chat/supabaseDb.ts";
import { log } from "../_shared/chat/log.ts";

const url = Deno.env.get("SUPABASE_URL")!;
const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const openaiKey = Deno.env.get("OPENAI_API_KEY") ?? "";
const production = Deno.env.get("SAOHLIN_ENV") === "production";

const service = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
const auth = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
const db = supabaseDb(service);
const ai = new OpenAI(openaiKey);

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-region",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });
}

async function userIdFrom(req: Request): Promise<string | null> {
  const token = req.headers.get("Authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) return null;
  // deno-lint-ignore no-explicit-any
  const a = auth.auth as any;
  if (typeof a.getClaims === "function") {
    const { data, error } = await a.getClaims(token);
    if (error || !data?.claims?.sub || data.claims.role !== "authenticated") return null;
    return data.claims.sub as string;
  }
  const { data, error } = await auth.auth.getUser(token);
  return error || !data?.user ? null : data.user.id;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json(405, { code: "INVALID_INPUT" });

  const userId = await userIdFrom(req);
  if (!userId) return json(401, { code: "UNAUTHENTICATED" });

  let body;
  try {
    body = parseRequest(await req.json());
  } catch (e) {
    log("chat.invalid_input", { field: e instanceof InvalidInput ? e.field : "json" });
    return json(400, { code: "INVALID_INPUT" });
  }

  const cfg = await db.config(["app.maintenance"]);
  if (cfg["app.maintenance"] === true) return json(503, { code: "MAINTENANCE" });

  const enc = new TextEncoder();
  let controller: ReadableStreamDefaultController<Uint8Array> | null = null;
  let open = true;
  const emit = (e: ChatEvent) => {
    if (!open || !controller) return;
    try {
      controller.enqueue(enc.encode(sse(e)));
    } catch {
      open = false; // the phone went away; the turn carries on and is stored
    }
  };

  const stream = new ReadableStream<Uint8Array>({
    start(c) {
      controller = c;
      const work = runTurn({ db, ai, production }, userId, body, emit)
        .catch(() => emit({ event: "error", data: { code: "AI_UNAVAILABLE", retryable: true } }))
        .finally(() => {
          if (open) {
            open = false;
            try { c.close(); } catch { /* closed */ }
          }
        });
      // Keep the isolate alive until the turn is stored, even if the client left.
      // deno-lint-ignore no-explicit-any
      (globalThis as any).EdgeRuntime?.waitUntil?.(work);
    },
    cancel() {
      open = false;
    },
  });

  return new Response(stream, {
    headers: { ...CORS, "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-cache", "X-Accel-Buffering": "no" },
  });
});
