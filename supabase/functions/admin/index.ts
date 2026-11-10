// POST /functions/v1/admin -- the admin web app's only way into the data.
//
// Deployed with JWT verification on. Called by the admin web app's server with
// the admin's own access token, never from a browser, so it sends no CORS
// headers. The checks and the actions are in handler.ts.
//
// SUPABASE_URL, SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY are provided
// by the platform. No other secret is needed.
import { createClient } from "npm:@supabase/supabase-js@2";
import { log } from "../_shared/chat/log.ts";
import { makeHandler, type Claims } from "./handler.ts";

const url = Deno.env.get("SUPABASE_URL")!;
const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const opts = { auth: { persistSession: false, autoRefreshToken: false } };
const auth = createClient(url, anonKey, opts);
const service = createClient(url, serviceKey, opts);

Deno.serve(makeHandler({
  // getClaims verifies the token's signature (and asks the auth server when the
  // project still signs with a shared secret), then returns aal and app_metadata.
  verify: async (token) => {
    const { data, error } = await auth.auth.getClaims(token);
    return error || !data?.claims ? null : (data.claims as unknown as Claims);
  },
  rpc: async (fn, args) => {
    const { data, error } = await service.rpc(fn, args);
    return { data, error };
  },
  log,
  art: {
    signUpload: async (path) => {
      const { data, error } = await service.storage.from("card-art").createSignedUploadUrl(path);
      return error || !data ? null : { signedUrl: data.signedUrl, token: data.token, path: data.path };
    },
    remove: async (paths) => {
      const { error } = await service.storage.from("card-art").remove(paths);
      if (error) throw error;
    },
  },
}));
