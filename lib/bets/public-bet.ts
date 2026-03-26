import "server-only";

import type { Json } from "@/types/database";
import { createServerSupabase } from "@/lib/supabase/server";

export async function getPublicBetBySlug(slug: string): Promise<Json | null> {
  let supabase;
  try {
    supabase = await createServerSupabase();
  } catch {
    return null;
  }

  const { data, error } = await supabase.rpc("get_bet_by_slug", {
    p_slug: slug,
  });

  if (error) {
    console.error("get_bet_by_slug", error);
    return null;
  }

  return data ?? null;
}
