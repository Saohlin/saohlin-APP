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

/** The card-art storage bucket. */
export type CardArt = {
  /** A one-time upload URL for this path, or null when storage refuses. */
  signUpload: (path: string) => Promise<{ signedUrl: string; token: string; path: string } | null>;
  /** Removes files no card uses any more. Failures are logged, never fatal. */
  remove: (paths: string[]) => Promise<void>;
};

export type Deps = {
  /** Verifies the token and returns its claims, or null when it is not valid. */
  verify: (token: string) => Promise<Claims | null>;
  rpc: Rpc;
  log: Log;
  art: CardArt;
};

export const MARKS = ["right", "too_generic", "should_have_asked", "wrong_guide"] as const;
export const STATUSES = ["new", "in_progress", "fixed", "wont_fix"] as const;
export const CARD_STATUSES = ["draft", "published"] as const;
export const ART_TYPES = ["png", "jpg", "webp"] as const;
/** Longest allowed length of each card text, as in the cards table. */
export const CARD_LIMITS = { name: 60, keyword: 40, quote: 300, message: 2000, step: 3000, mantra: 500, meaning: 30000 } as const;
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

function uuids(v: unknown, max: number): string[] {
  if (!Array.isArray(v) || v.length === 0 || v.length > max) throw new Invalid();
  return v.map(uuid);
}

function text(v: unknown, max: number): string | null {
  if (v === undefined || v === null) return null;
  if (typeof v !== "string" || v.length > max) throw new Invalid();
  return v;
}

/** A card from the admin form: every field checked against the table's limits. */
function cardInput(v: unknown): Record<string, unknown> {
  if (typeof v !== "object" || v === null || Array.isArray(v)) throw new Invalid();
  const c = v as Payload;
  const name = text(c.name, CARD_LIMITS.name)?.trim();
  if (!name) throw new Invalid();
  const keywords = c.keywords ?? [];
  if (!Array.isArray(keywords) || keywords.length > 5) throw new Invalid();
  return {
    name,
    keywords: keywords.map((k) => text(k, CARD_LIMITS.keyword) ?? ""),
    quote: text(c.quote, CARD_LIMITS.quote),
    message: text(c.message, CARD_LIMITS.message),
    step: text(c.step, CARD_LIMITS.step),
    mantra: text(c.mantra, CARD_LIMITS.mantra),
    meaning: text(c.meaning, CARD_LIMITS.meaning),
    ...(c.status === undefined || c.status === null ? {} : { status: oneOf(c.status, CARD_STATUSES, false) }),
  };
}

/** The artwork path the database hands back for removal, if any. */
function removable(data: unknown): string | null {
  const v = (data as { removeArt?: unknown } | null)?.removeArt;
  return typeof v === "string" ? v : null;
}

type Call = {
  fn: string;
  args: Record<string, unknown>;
  /** Runs after the database call succeeds; its result is what the caller gets. */
  after?: (data: unknown, deps: Deps) => Promise<unknown>;
};

async function removeArt(data: unknown, deps: Deps) {
  const path = removable(data);
  if (path) await deps.art.remove([path]).catch(() => deps.log("admin.art_remove_failed", { path }));
}

/** Each action: check the payload, then name the database function and its arguments. */
const ACTIONS: Record<string, (admin: string, p: Payload) => Call> = {
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

  "cards.list": (admin) => ({ fn: "admin_cards_list", args: { p_admin: admin } }),
  "cards.get": (admin, p) => ({ fn: "admin_cards_get", args: { p_admin: admin, p_id: uuid(p.id) } }),
  "cards.save": (admin, p) => ({
    fn: "admin_cards_save",
    args: { p_admin: admin, p_id: p.id === undefined || p.id === null ? null : uuid(p.id), p_card: cardInput(p.card) },
  }),
  "cards.status": (admin, p) => ({
    fn: "admin_cards_set_status",
    args: { p_admin: admin, p_ids: uuids(p.ids, 500), p_status: oneOf(p.status, CARD_STATUSES, false) },
  }),
  "cards.reorder": (admin, p) => ({ fn: "admin_cards_reorder", args: { p_admin: admin, p_ids: uuids(p.ids, 500) } }),
  "cards.duplicate": (admin, p) => ({ fn: "admin_cards_duplicate", args: { p_admin: admin, p_id: uuid(p.id) } }),
  "cards.delete": (admin, p) => ({
    fn: "admin_cards_delete",
    args: { p_admin: admin, p_id: uuid(p.id) },
    after: async (data, deps) => {
      await removeArt(data, deps);
      return { deleted: true };
    },
  }),
  // A signed upload for new artwork. The card lookup re-checks the admin flag and
  // that the card exists; the file lands in the card's own folder under a new name.
  "cards.uploadUrl": (admin, p) => {
    const id = uuid(p.id);
    const ext = oneOf(p.type, ART_TYPES, false);
    return {
      fn: "admin_cards_get",
      args: { p_admin: admin, p_id: id },
      after: async (_data, deps) => {
        const signed = await deps.art.signUpload(`${id}/${crypto.randomUUID()}.${ext}`);
        if (!signed) throw new Error("STORAGE");
        return signed;
      },
    };
  },
  "cards.setArt": (admin, p) => ({
    fn: "admin_cards_set_art",
    args: {
      p_admin: admin,
      p_id: uuid(p.id),
      p_path: p.path === undefined || p.path === null ? null : text(p.path, 120),
    },
    after: async (data, deps) => {
      await removeArt(data, deps);
      return (data as { card?: unknown } | null)?.card ?? null;
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
  if (code === "22023" || code === "23514" || msg === "INVALID_INPUT") return json(400, { code: "INVALID_INPUT" });
  if (msg === "NO_ART") return json(409, { code: "NO_ART" });
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

    let call: Call;
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
    let result = data;
    if (call.after) {
      try {
        result = await call.after(data, deps);
      } catch {
        deps.log("admin.failed", { action, code: "after" });
        return json(500, { code: "INTERNAL" });
      }
    }
    deps.log("admin.ok", { action, admin });
    return json(200, { data: result });
  };
}
