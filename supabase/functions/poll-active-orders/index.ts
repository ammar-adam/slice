import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { corsHeaders } from "../_shared/cors.ts";
import { getServiceSupabase } from "../_shared/supabase.ts";
import {
  ensureHostGmailAccessToken,
  getHeader,
  getMessageBodyText,
  getMessageFull,
  listMessageIds,
  messageInternalDate,
  type GoogleOAuthRow,
  UBER_EATS_GMAIL_QUERY_3H,
} from "../_shared/gmail.ts";
import {
  detectPlatformFromHeaders,
  detectUberEatsEmailType,
  normalizeRestaurantKey,
  parseUberEatsForIngest,
} from "../_shared/uber-eats-parser.ts";
import { actualMinutesBetween, pickOrderForDelivery } from "../_shared/orders.ts";

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "content-type": "application/json" },
  });
}

async function broadcast(
  supabase: ReturnType<typeof getServiceSupabase> extends { ok: true; supabase: infer S }
    ? S
    : never,
  orderId: string,
  event: "eta_update" | "delivered",
  payload: Record<string, unknown>,
) {
  try {
    const channel = supabase.realtime.channel(`order:${orderId}`);
    await channel.send({ type: "broadcast", event, payload });
    await supabase.realtime.removeChannel(channel);
  } catch {
    // best-effort
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const sb0 = getServiceSupabase();
    if (!sb0.ok) {
      return json({ ok: false, error: { code: sb0.error, message: sb0.error } }, 500);
    }
    const supabase = sb0.supabase;

    const since4h = new Date(Date.now() - 4 * 3600_000).toISOString();
    const { data: activeOrders, error: oErr } = await supabase.from("orders").select(
      "id,host_id,restaurant_name_normalized,order_placed_at,eta_initial_minutes,eta_final_minutes,actual_delivery_minutes,resolved,gmail_message_id_enroute,gmail_message_id_delivered",
    ).eq("resolved", false).gt("order_placed_at", since4h);
    if (oErr) {
      return json({ ok: false, error: { code: "orders_query_failed", message: oErr.message } }, 500);
    }

    const byHost = new Map<string, typeof activeOrders>();
    for (const o of activeOrders ?? []) {
      const list = byHost.get(o.host_id) ?? [];
      list.push(o);
      byHost.set(o.host_id, list);
    }

    const summary = {
      hosts: byHost.size,
      orders_checked: (activeOrders ?? []).length,
      eta_updates: 0,
      delivered_updates: 0,
      errors: [] as string[],
    };

    for (const [hostId, hostOrders] of byHost) {
      const { data: tokRow, error: tErr } = await supabase
        .from("google_oauth_tokens")
        .select("*")
        .eq("host_id", hostId)
        .maybeSingle();

      if (tErr || !tokRow) {
        summary.errors.push(`host ${hostId}: oauth_missing`);
        continue;
      }

      const oauth = tokRow as GoogleOAuthRow;
      const token = await ensureHostGmailAccessToken(supabase, oauth);
      if (!token.ok) {
        summary.errors.push(`host ${hostId}: token ${token.error}`);
        continue;
      }

      const { data: syncState } = await supabase
        .from("gmail_sync_state")
        .select("last_synced_at")
        .eq("host_id", hostId)
        .maybeSingle();
      const lastSyncedAt = syncState?.last_synced_at ? Date.parse(syncState.last_synced_at) : 0;

      const listed = await listMessageIds(token.accessToken, UBER_EATS_GMAIL_QUERY_3H);
      if (!listed.ok) {
        summary.errors.push(`host ${hostId}: gmail_list ${listed.error}`);
        continue;
      }

      // Hydrate and filter messages newer than last_synced_at.
      const hydrated: { id: string; receivedAt: Date; body: string }[] = [];
      for (const id of listed.ids) {
        const got = await getMessageFull(token.accessToken, id);
        if (!got.ok) continue;
        const receivedAt = messageInternalDate(got.message);
        if (receivedAt.getTime() <= lastSyncedAt) continue;
        const from = getHeader(got.message, "From");
        const subject = getHeader(got.message, "Subject");
        if (detectPlatformFromHeaders({ from, subject }) !== "uber_eats") continue;
        const body = getMessageBodyText(got.message);
        hydrated.push({ id, receivedAt, body });
      }

      hydrated.sort((a, b) => a.receivedAt.getTime() - b.receivedAt.getTime());

      // ETA updates from enroute emails.
      for (const m of hydrated) {
        const kind = detectUberEatsEmailType(m.body);
        if (kind !== "enroute") continue;
        const draft = parseUberEatsForIngest(m.body, m.receivedAt);
        if (!draft || draft.kind !== "enroute") continue;
        if (draft.etaFinalMinutes == null) continue;

        const cand = {
          messageId: m.id,
          receivedAt: m.receivedAt,
          restaurantNorm: normalizeRestaurantKey(draft.restaurantName),
        };

        const match = pickOrderForDelivery(
          hostOrders as any,
          cand,
          new Set(),
          4 * 3600_000,
          (o) => !o.gmail_message_id_enroute,
        );
        if (!match) continue;

        const { error: upErr } = await supabase.from("orders").update({
          eta_final_minutes: draft.etaFinalMinutes,
          gmail_message_id_enroute: m.id,
        }).eq("id", match.id);
        if (upErr) {
          summary.errors.push(`order ${match.id}: eta_update ${upErr.message}`);
          continue;
        }
        summary.eta_updates += 1;
        await broadcast(supabase as any, match.id, "eta_update", {
          type: "eta_update",
          eta_final_minutes: draft.etaFinalMinutes,
        });
      }

      // Delivery updates from delivered emails (then trigger full resolve).
      for (const m of hydrated) {
        const kind = detectUberEatsEmailType(m.body);
        if (kind !== "delivered") continue;
        const pre = parseUberEatsForIngest(m.body, m.receivedAt);
        if (!pre || pre.kind !== "delivered") continue;

        const cand = {
          messageId: m.id,
          receivedAt: m.receivedAt,
          restaurantNorm: normalizeRestaurantKey(pre.restaurantName),
        };

        const match = pickOrderForDelivery(
          hostOrders as any,
          cand,
          new Set(),
          4 * 3600_000,
          (o) => !o.gmail_message_id_delivered,
        );
        if (!match) continue;

        const mins = actualMinutesBetween(match.order_placed_at, m.receivedAt);
        if (mins == null) continue;

        const { error: upErr } = await supabase.from("orders").update({
          actual_delivery_minutes: mins,
          gmail_message_id_delivered: m.id,
        }).eq("id", match.id);
        if (upErr) {
          summary.errors.push(`order ${match.id}: delivered_update ${upErr.message}`);
          continue;
        }

        summary.delivered_updates += 1;
        await broadcast(supabase as any, match.id, "delivered", {
          type: "delivered",
          actual_minutes: mins,
        });

        // Trigger full settle/void for this order.
        await supabase.functions.invoke("resolve-bets", { body: { order_id: match.id } });
      }

      const nowIso = new Date().toISOString();
      await supabase.from("gmail_sync_state").upsert(
        { host_id: hostId, last_synced_at: nowIso },
        { onConflict: "host_id" },
      );
    }

    return json({ ok: true, summary });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return json({ ok: false, error: { code: "unhandled", message } }, 500);
  }
});

