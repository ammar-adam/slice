import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { corsHeaders } from "../_shared/cors.ts";
import { getServiceSupabase } from "../_shared/supabase.ts";
import { actualMinutesBetween } from "../_shared/orders.ts";
import {
  fetchActiveOrder,
  sessionFromRow,
  type UberSessionRow,
} from "../_shared/uber-eats-api.ts";

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
  event: "location_update" | "eta_update" | "delivered",
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

type OrderRow = {
  id: string;
  host_id: string;
  uber_order_uuid: string | null;
  order_placed_at: string;
};

function pickOrderForLive(
  hostOrders: OrderRow[],
  liveUuid: string | null,
): OrderRow | null {
  if (liveUuid) {
    const m = hostOrders.find((o) => o.uber_order_uuid === liveUuid);
    if (m) return m;
  }
  if (hostOrders.length === 1) return hostOrders[0]!;
  return null;
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
    const { data: activeOrders, error: oErr } = await supabase
      .from("orders")
      .select("id,host_id,uber_order_uuid,order_placed_at,resolved")
      .eq("resolved", false)
      .gt("order_placed_at", since4h);
    if (oErr) {
      return json({ ok: false, error: { code: "orders_query_failed", message: oErr.message } }, 500);
    }

    const byHost = new Map<string, OrderRow[]>();
    for (const o of activeOrders ?? []) {
      const list = byHost.get(o.host_id) ?? [];
      list.push(o as OrderRow);
      byHost.set(o.host_id, list);
    }

    const summary = {
      hosts: byHost.size,
      orders_tracked: (activeOrders ?? []).length,
      location_updates: 0,
      delivered_updates: 0,
      skipped_no_session: 0,
      errors: [] as string[],
    };

    for (const [hostId, hostOrders] of byHost) {
      const { data: sess, error: sErr } = await supabase
        .from("uber_sessions")
        .select("cookie_ciphertext,x_csrf_token,authorization_header")
        .eq("host_id", hostId)
        .maybeSingle();

      if (sErr || !sess) {
        summary.skipped_no_session += 1;
        continue;
      }

      let live: Awaited<ReturnType<typeof fetchActiveOrder>>;
      try {
        const { headers } = await sessionFromRow(sess as UberSessionRow);
        live = await fetchActiveOrder(headers);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        summary.errors.push(`host ${hostId}: ${msg}`);
        continue;
      }

      if (!live) continue;

      const match = pickOrderForLive(hostOrders, live.uberOrderUuid);
      if (!match) continue;

      const now = Date.now();
      const etaRemaining =
        live.estimatedArrivalTime != null
          ? Math.max(0, Math.round((live.estimatedArrivalTime - now) / 60_000))
          : null;

      const statusUp = live.currentStatus.toUpperCase();
      const isDelivered =
        statusUp === "DELIVERED" ||
        statusUp.includes("DELIVERED");

      if (!isDelivered) {
        if (etaRemaining != null) {
          const { error: upErr } = await supabase
            .from("orders")
            .update({ eta_final_minutes: etaRemaining })
            .eq("id", match.id);
          if (upErr) {
            summary.errors.push(`order ${match.id}: eta ${upErr.message}`);
          }
        }

        const lat = live.courierLocation?.latitude;
        const lng = live.courierLocation?.longitude;
        if (typeof lat === "number" && typeof lng === "number" && Number.isFinite(lat) &&
          Number.isFinite(lng)) {
          await broadcast(supabase as any, match.id, "location_update", {
            type: "location_update",
            lat,
            lng,
            eta_remaining_minutes: etaRemaining,
          });
          summary.location_updates += 1;
        } else if (etaRemaining != null) {
          await broadcast(supabase as any, match.id, "eta_update", {
            type: "eta_update",
            eta_final_minutes: etaRemaining,
          });
        }
        continue;
      }

      const mins = actualMinutesBetween(match.order_placed_at, new Date());
      if (mins == null) continue;

      const { error: upErr } = await supabase
        .from("orders")
        .update({
          actual_delivery_minutes: mins,
          resolved: true,
          resolved_at: new Date().toISOString(),
        })
        .eq("id", match.id);
      if (upErr) {
        summary.errors.push(`order ${match.id}: delivered ${upErr.message}`);
        continue;
      }

      summary.delivered_updates += 1;
      await broadcast(supabase as any, match.id, "delivered", {
        type: "delivered",
        actual_minutes: mins,
      });
      await supabase.functions.invoke("resolve-bets", { body: { order_id: match.id } });
    }

    return json({ ok: true, summary });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return json({ ok: false, error: { code: "unhandled", message } }, 500);
  }
});
