// The admin API: every request from the admin web app goes through here.
//
// Three checks before any database call: a verified token for a signed-in
// user, two-factor done in this session (aal2), and the admin flag in
// app_metadata (which users cannot edit). The admin id passed to the database
// comes from the token, never from the body, and every admin_* database
// function checks the flag again.
//
// Pure: the token check and the database are passed in, so this is tested
// without Supabase (handler_test.ts). index.ts wires the real ones.

export type Claims = {
  sub: string;
  role?: string;
  aal?: string;
  email?: string;
  app_metadata?: Record<string, unknown>;
};

export type DbError = { code?: string; message?: string } | null;
export type Rpc = (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: DbError }>;
export type Log = (event: string, fields?: Record<string, string | number | boolean | null | undefined>) => void;

export type Deps = {
  /** Verifies the token and returns its claims, or null when it is not valid. */
  verify: (token: string) => Promise<Claims | null>;
  rpc: Rpc;
  log: Log;
};

export const MARKS = ["right", "too_generic", "should_have_asked", "wrong_guide"] as const;
export const STATUSES = ["new", "in_progress", "fixed", "wont_fix"] as const;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

class Invalid extends Error {}

type Payload = Record<string, unknown>;

function oneOf<T extends string>(v: unknown, allowed: readonly T[], optional: boolean): T | null {
  if (v === undefined || v === null) {
    if (optional) return null;
    throw new Invalid();
  }
  if (typeof v !== "string" || !(allowed as readonly string[]).includes(v)) throw new Invalid();
  return v as T;
}

function int(v: unknown, fallback: number, min: number, max: number): number {
  if (v === undefined || v === null) return fallback;
  if (typeof v !== "number" || !Number.isInteger(v) || v < min || v > max) throw new Invalid();
  return v;
}

function uuid(v: unknown): string {
  if (typeof v !== "string" || !UUID.test(v)) throw new Invalid();
  return v;
}

function comment(v: unknown): string | null {
  if (v === undefined || v === null) return null;
  if (typeof v !== "string" || v.length > 2000) throw new Invalid();
  return v;
}

/** Each action: check the payload, then name the database function and its arguments. */
const ACTIONS: Record<string, (admin: string, p: Payload) => { fn: string; args: Record<string, unknown> }> = {
  "testing.list": (admin, p) => ({
    fn: "admin_testing_list",
    args: {
      p_admin: admin,
      p_mark: oneOf(p.mark, MARKS, true),
      p_status: oneOf(p.status, STATUSES, true),
      p_limit: int(p.limit, 25, 1, 100),
      p_offset: int(p.offset, 0, 0, 1_000_000),
    },
  }),
  "testing.get": (admin, p) => ({
    fn: "admin_testing_get",
    args: { p_admin: admin, p_mark_id: uuid(p.markId) },
  }),
  "testing.review": (admin, p) => ({
    fn: "admin_testing_review",
    args: {
      p_admin: admin,
      p_mark_id: uuid(p.markId),
      p_status: oneOf(p.status, STATUSES, false),
      p_comment: comment(p.comment),
    },
  }),
};

export const ACTION_NAMES = ["me", ...Object.keys(ACTIONS)];

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

/** Database errors to HTTP, by the codes the admin functions raise. Never passes on the message. */
function fromDb(error: NonNullable<DbError>): Response {
  const code = error.code ?? "";
  const msg = error.message ?? "";
  if (code === "42501" || msg === "FORBIDDEN") return json(403, { code: "FORBIDDEN" });
  if (code === "P0002" || msg === "NOT_FOUND") return json(404, { code: "NOT_FOUND" });
  if (code === "22023" || msg === "INVALID_INPUT") return json(400, { code: "INVALID_INPUT" });
  return json(500, { code: "INTERNAL" });
}

export function makeHandler(deps: Deps) {
  return async (req: Request): Promise<Response> => {
    if (req.method !== "POST") return json(405, { code: "METHOD_NOT_ALLOWED" });

    const token = req.headers.get("Authorization")?.replace(/^Bearer\s+/i, "") ?? "";
    const claims = token ? await deps.verify(token).catch(() => null) : null;
    if (!claims?.sub || claims.role !== "authenticated") return json(401, { code: "UNAUTHENTICATED" });
    if (claims.aal !== "aal2") return json(403, { code: "MFA_REQUIRED" });
    if (claims.app_metadata?.saohlin_admin !== true) {
      deps.log("admin.refused", { user: claims.sub, reason: "not_admin" });
      return json(403, { code: "FORBIDDEN" });
    }
    const admin = claims.sub;

    let action: string;
    let payload: Payload;
    try {
      const body = await req.json();
      if (typeof body !== "object" || body === null || typeof body.action !== "string") throw new Invalid();
      action = body.action;
      payload = body.payload ?? {};
      if (typeof payload !== "object" || payload === null || Array.isArray(payload)) throw new Invalid();
    } catch {
      return json(400, { code: "INVALID_INPUT" });
    }

    if (action === "me") {
      const { data, error } = await deps.rpc("admin_overview", { p_admin: admin });
      if (error) {
        deps.log("admin.failed", { action, code: error.code ?? "unknown" });
        return fromDb(error);
      }
      return json(200, { data: { id: admin, email: claims.email ?? null, overview: data } });
    }

    const build = ACTIONS[action];
    if (!build) return json(400, { code: "INVALID_INPUT" });

    let call: { fn: string; args: Record<string, unknown> };
    try {
      call = build(admin, payload);
    } catch {
      return json(400, { code: "INVALID_INPUT" });
    }

    const { data, error } = await deps.rpc(call.fn, call.args);
    if (error) {
      deps.log("admin.failed", { action, code: error.code ?? "unknown" });
      return fromDb(error);
    }
    deps.log("admin.ok", { action, admin });
    return json(200, { data });
  };
}
