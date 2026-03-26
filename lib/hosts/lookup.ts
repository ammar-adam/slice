import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";

export async function getHostIdByNextAuthUserId(
  nextauthUserId: string
): Promise<string | null> {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("hosts")
    .select("id")
    .eq("nextauth_user_id", nextauthUserId)
    .maybeSingle();

  if (error) {
    console.error("hosts lookup", error);
    return null;
  }
  return data?.id ?? null;
}

export async function ensureHostByNextAuthUserId(args: {
  nextauthUserId: string;
  email?: string | null;
}): Promise<string> {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("hosts")
    .upsert(
      {
        nextauth_user_id: args.nextauthUserId,
        email: args.email ?? null,
      },
      { onConflict: "nextauth_user_id" }
    )
    .select("id")
    .single();

  if (error || !data) {
    throw error ?? new Error("host upsert failed");
  }
  return data.id;
}
