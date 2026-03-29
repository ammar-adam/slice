import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import { decryptUberSessionCookie } from "@/lib/uber/crypto";
import { getPastOrders, toOrderRowFields } from "@/lib/uber/client";

const HOURS_24_MS = 24 * 3600_000;

export async function syncUberPastOrdersForHost(hostId: string): Promise<number> {
  const supabase = createAdminClient();
  const { data: row, error } = await supabase
    .from("uber_sessions")
    .select("cookie_ciphertext, x_csrf_token, authorization_header")
    .eq("host_id", hostId)
    .maybeSingle();

  if (error || !row) {
    throw new Error(error?.message ?? "no_uber_session");
  }

  const cookie_string = decryptUberSessionCookie(
    row.cookie_ciphertext as string,
  );
  const session = {
    cookie_string,
    x_csrf_token: (row.x_csrf_token as string | null) ?? null,
    authorization_header: (row.authorization_header as string | null) ?? null,
  };

  const past = await getPastOrders(session, 50);
  const cutoff = Date.now() - HOURS_24_MS;
  const recent = past.filter((p) => p.orderPlacedAt.getTime() >= cutoff);
  if (recent.length === 0) return 0;

  const rows = recent.map((p) => toOrderRowFields(p, hostId));
  const { error: upErr } = await supabase.from("orders").upsert(rows, {
    onConflict: "host_id,uber_order_uuid",
  });
  if (upErr) {
    throw new Error(upErr.message);
  }

  return rows.length;
}
