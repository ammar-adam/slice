import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

export function getServiceSupabase():
  | { ok: true; supabase: SupabaseClient }
  | { ok: false; error: string } {
  const url = Deno.env.get("SUPABASE_URL") ?? "";
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  if (!url || !key) {
    return { ok: false, error: "missing_supabase_env" };
  }
  return {
    ok: true,
    supabase: createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false },
    }),
  };
}

export function requireServiceRoleAuth(req: Request):
  | { ok: true }
  | { ok: false; error: string; status: number } {
  const expected = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  if (!expected) {
    return { ok: false, error: "server_misconfigured", status: 500 };
  }
  const auth = req.headers.get("authorization") ?? "";
  const m = auth.match(/^Bearer\s+(.+)$/i);
  const token = m?.[1]?.trim() ?? "";
  if (token !== expected) {
    return { ok: false, error: "unauthorized", status: 401 };
  }
  return { ok: true };
}
