import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";

const SYNTH_PREFIX = "whatsapp:";

export function syntheticNextAuthIdForWhatsApp(wa_id: string): string {
  return `${SYNTH_PREFIX}${wa_id}`;
}

/**
 * Ensures a hosts row (synthetic nextauth_user_id) and whatsapp_identities mapping exist.
 * Returns host_id.
 */
export async function ensureHostForWhatsApp(wa_id: string): Promise<string> {
  const supabase = createAdminClient();
  const synthetic = syntheticNextAuthIdForWhatsApp(wa_id);

  const { data: existingMap, error: mapErr } = await supabase
    .from("whatsapp_identities")
    .select("host_id")
    .eq("wa_id", wa_id)
    .maybeSingle();

  if (mapErr) {
    console.error("whatsapp_identities lookup", mapErr);
  }
  if (existingMap && typeof (existingMap as { host_id?: unknown }).host_id === "string") {
    return String((existingMap as { host_id: string }).host_id);
  }

  const { data: bySynth, error: hostErr } = await supabase
    .from("hosts")
    .select("id")
    .eq("nextauth_user_id", synthetic)
    .maybeSingle();

  if (hostErr) console.error("hosts lookup synthetic", hostErr);
  if (bySynth && typeof (bySynth as { id?: unknown }).id === "string") {
    const hostId = String((bySynth as { id: string }).id);
    const { error: insId } = await supabase.from("whatsapp_identities").upsert(
      { wa_id, host_id: hostId },
      { onConflict: "wa_id" }
    );
    if (insId) console.error("whatsapp_identities upsert", insId);
    await supabase.from("hosts").update({ whatsapp_wa_id: wa_id }).eq("id", hostId);
    return hostId;
  }

  const { data: newHost, error: insHost } = await supabase
    .from("hosts")
    .insert({
      nextauth_user_id: synthetic,
      whatsapp_wa_id: wa_id,
      email: null,
    })
    .select("id")
    .single();

  if (insHost || !newHost) {
    console.error("hosts insert wa", insHost);
    throw insHost ?? new Error("host insert failed");
  }

  const hostId = String((newHost as { id: string }).id);

  const { error: insMap } = await supabase.from("whatsapp_identities").insert({
    wa_id,
    host_id: hostId,
  });
  if (insMap) {
    console.error("whatsapp_identities insert", insMap);
  }

  return hostId;
}
