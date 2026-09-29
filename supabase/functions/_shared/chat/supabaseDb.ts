// The Db port over supabase-js with the service role key (functions only).
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { type Db, DbError } from "./turn.ts";

const CONFIG_TTL_MS = 60_000;
let configCache: { at: number; values: Record<string, unknown> } | null = null;

export function supabaseDb(client: SupabaseClient): Db {
  return {
    async rpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
      const { data, error } = await client.rpc(fn, args);
      if (error) throw new DbError(error.code ?? "unknown", error.message);
      return data as T;
    },
    async config(keys: string[]) {
      if (configCache && Date.now() - configCache.at < CONFIG_TTL_MS && keys.every((k) => k in configCache!.values)) {
        return configCache.values;
      }
      const { data, error } = await client.from("app_config").select("key, value").in("key", keys);
      if (error) throw new DbError(error.code ?? "unknown", error.message);
      const values: Record<string, unknown> = { ...(configCache?.values ?? {}) };
      for (const row of data ?? []) values[row.key] = row.value;
      configCache = { at: Date.now(), values };
      return values;
    },
  };
}
