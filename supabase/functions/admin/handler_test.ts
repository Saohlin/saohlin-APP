import assert from "node:assert/strict";
import { makeHandler, type Claims, type DbError } from "./handler.ts";

const ADMIN = "00000000-0000-0000-0000-0000000000ad";
const MARK = "11111111-2222-4333-8444-555555555555";

const admin: Claims = {
  sub: ADMIN, role: "authenticated", aal: "aal2", email: "admin@saohlin.com",
  app_metadata: { saohlin_admin: true },
};

type Call = { fn: string; args: Record<string, unknown> };

function setup(claims: Claims | null, result: { data?: unknown; error?: DbError } = {}) {
  const calls: Call[] = [];
  const logs: string[] = [];
  const handle = makeHandler({
    verify: () => Promise.resolve(claims),
    rpc: (fn, args) => {
      calls.push({ fn, args });
      return Promise.resolve({ data: result.data ?? { ok: true }, error: result.error ?? null });
    },
    log: (event, fields) => logs.push(`${event} ${JSON.stringify(fields ?? {})}`),
  });
  return { handle, calls, logs };
}

const post = (body: unknown, token: string | null = "tok") =>
  new Request("http://x/admin", {
    method: "POST",
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    body: typeof body === "string" ? body : JSON.stringify(body),
  });

const read = async (res: Response) => ({ status: res.status, body: await res.json() });

Deno.test("no token, or a token that does not verify, is 401", async () => {
  const { handle, calls } = setup(admin);
  assert.deepEqual(await read(await handle(post({ action: "me" }, null))), { status: 401, body: { code: "UNAUTHENTICATED" } });
  const bad = setup(null);
  assert.equal((await bad.handle(post({ action: "me" }))).status, 401);
  assert.equal(calls.length + bad.calls.length, 0);
});

Deno.test("an anonymous token is 401", async () => {
  const { handle } = setup({ ...admin, role: "anon" });
  assert.equal((await handle(post({ action: "me" }))).status, 401);
});

Deno.test("an admin without two-factor in this session is 403 MFA_REQUIRED", async () => {
  const { handle, calls } = setup({ ...admin, aal: "aal1" });
  assert.deepEqual(await read(await handle(post({ action: "me" }))), { status: 403, body: { code: "MFA_REQUIRED" } });
  assert.equal(calls.length, 0);
});

Deno.test("a signed-in user without the admin flag is 403, and the refusal is logged without content", async () => {
  for (const app_metadata of [{}, { saohlin_admin: "true" }, { saohlin_admin: false }]) {
    const { handle, calls, logs } = setup({ ...admin, app_metadata });
    assert.deepEqual(await read(await handle(post({ action: "me" }))), { status: 403, body: { code: "FORBIDDEN" } });
    assert.equal(calls.length, 0);
    assert.match(logs[0], /^admin.refused/);
  }
});

Deno.test("anything but POST is 405", async () => {
  const { handle } = setup(admin);
  assert.equal((await handle(new Request("http://x/admin", { method: "GET" }))).status, 405);
});

Deno.test("bad bodies and unknown actions are 400 and reach no database", async () => {
  const { handle, calls } = setup(admin);
  for (const body of ["not json", { payload: {} }, { action: "drop.everything" }, { action: "me", payload: [] },
                      { action: "testing.get", payload: { markId: "1 or 1=1" } },
                      { action: "testing.list", payload: { mark: "great" } },
                      { action: "testing.list", payload: { limit: 500 } },
                      { action: "testing.list", payload: { offset: -1 } },
                      { action: "testing.review", payload: { markId: MARK } },
                      { action: "testing.review", payload: { markId: MARK, status: "done" } },
                      { action: "testing.review", payload: { markId: MARK, status: "fixed", comment: "x".repeat(2001) } }]) {
    assert.deepEqual(await read(await handle(post(body))), { status: 400, body: { code: "INVALID_INPUT" } }, JSON.stringify(body));
  }
  assert.equal(calls.length, 0);
});

Deno.test("me returns who is signed in and the overview", async () => {
  const { handle, calls } = setup(admin, { data: { testers: 1 } });
  assert.deepEqual(await read(await handle(post({ action: "me" }))), {
    status: 200, body: { data: { id: ADMIN, email: "admin@saohlin.com", overview: { testers: 1 } } },
  });
  assert.deepEqual(calls, [{ fn: "admin_overview", args: { p_admin: ADMIN } }]);
});

Deno.test("each action calls its function with the admin id from the token, never from the body", async () => {
  const { handle, calls } = setup(admin);
  const spoof = "99999999-9999-4999-8999-999999999999";
  await handle(post({ action: "testing.list", payload: { p_admin: spoof, admin: spoof, mark: "too_generic", limit: 10 } }));
  await handle(post({ action: "testing.get", payload: { markId: MARK, p_admin: spoof } }));
  await handle(post({ action: "testing.review", payload: { markId: MARK, status: "fixed", comment: "Opraveno" } }));
  assert.deepEqual(calls, [
    { fn: "admin_testing_list", args: { p_admin: ADMIN, p_mark: "too_generic", p_status: null, p_limit: 10, p_offset: 0 } },
    { fn: "admin_testing_get", args: { p_admin: ADMIN, p_mark_id: MARK } },
    { fn: "admin_testing_review", args: { p_admin: ADMIN, p_mark_id: MARK, p_status: "fixed", p_comment: "Opraveno" } },
  ]);
});

Deno.test("database errors map to codes and never pass the message on", async () => {
  const cases: [DbError, number, string][] = [
    [{ code: "42501", message: "FORBIDDEN" }, 403, "FORBIDDEN"],
    [{ code: "P0002", message: "NOT_FOUND" }, 404, "NOT_FOUND"],
    [{ code: "22023", message: "INVALID_INPUT" }, 400, "INVALID_INPUT"],
    [{ code: "XX000", message: "relation kb.secret does not exist" }, 500, "INTERNAL"],
  ];
  for (const [error, status, code] of cases) {
    const { handle, logs } = setup(admin, { error });
    const res = await read(await handle(post({ action: "testing.get", payload: { markId: MARK } })));
    assert.deepEqual(res, { status, body: { code } });
    assert.ok(!logs.join("").includes("kb.secret"));
  }
});
