import "server-only";

import type { Json } from "@/types/database";
import { createAdminClient } from "@/lib/supabase/admin";

export type ConversationStateRow = {
  state: string;
  context: Record<string, unknown>;
};

const TABLE = "whatsapp_conversation_state";

export async function getState(wa_id: string): Promise<ConversationStateRow> {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from(TABLE)
    .select("state, context_json")
    .eq("wa_id", wa_id)
    .maybeSingle();

  if (error) {
    console.error("getState", error);
    return { state: "idle", context: {} };
  }
  if (!data) return { state: "idle", context: {} };
  const row = data as { state?: unknown; context_json?: unknown };
  const state = typeof row.state === "string" && row.state.length ? row.state : "idle";
  const ctxRaw = row.context_json;
  const context =
    ctxRaw && typeof ctxRaw === "object" && !Array.isArray(ctxRaw)
      ? (ctxRaw as Record<string, unknown>)
      : {};
  return { state, context };
}

export async function setState(wa_id: string, state: string, context: Record<string, unknown>): Promise<void> {
  const supabase = createAdminClient();
  const { error } = await supabase.from(TABLE).upsert(
    {
      wa_id,
      state,
      context_json: context as Json,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "wa_id" }
  );
  if (error) console.error("setState", error);
}

export async function clearState(wa_id: string): Promise<void> {
  const supabase = createAdminClient();
  const { error } = await supabase.from(TABLE).delete().eq("wa_id", wa_id);
  if (error) console.error("clearState", error);
}
