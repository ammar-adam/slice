import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { corsHeaders } from "../_shared/cors.ts";
import {
  detectPlatformFromHeaders,
  detectUberEatsEmailType,
  normalizeRestaurantKey,
  parseUberEatsForIngest,
} from "../_shared/uber-eats-parser.ts";
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
  actualMinutesBetween,
  pickOrderForDelivery,
  type DeliveryCandidate,
  type UnresolvedOrderRow,
} from "../_shared/orders.ts";
import { getServiceSupabase } from "../_shared/supabase.ts";
import {
  resolveBetAndParticipants,
  voidOpenBet,
} from "../_shared/bet-resolution.ts";

type BetNested = {
  id: string;
  host_id: string;
  status: string;
  resolve_deadline_at: string;
  delay_probability: number;
};

type OrderWithBets = UnresolvedOrderRow & { bets: BetNested[] | null };

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "content-type": "application/json" },
  });
}

async function fetchDeliveredCandidates(
  accessToken: string,
): Promise<
  | { ok: true; items: DeliveryCandidate[] }
  | { ok: false; error: string }
> {
  const listed = await listMessageIds(accessToken, UBER_EATS_GMAIL_QUERY_3H);
  if (!listed.ok) {
    return { ok: false, error: listed.error };
  }
  const items: DeliveryCandidate[] = [];
  for (const id of listed.ids) {
    const got = await getMessageFull(accessToken, id);
    if (!got.ok) continue;
    const body = getMessageBodyText(got.message);
    if (detectUberEatsEmailType(body) !== "delivered") continue;
    const from = getHeader(got.message, "From");
    const subject = getHeader(got.message, "Subject");
    if (detectPlatformFromHeaders({ from, subject }) !== "uber_eats") {
      continue;
    }
    const internalDate = messageInternalDate(got.message);
    const parsed = parseUberEatsForIngest(body, internalDate);
    if (!parsed || parsed.kind !== "delivered") continue;
    items.push({
      messageId: id,
      receivedAt: internalDate,
      restaurantNorm: normalizeRestaurantKey(parsed.restaurantName),
    });
  }
  items.sort((a, b) => a.receivedAt.getTime() - b.receivedAt.getTime());
  return { ok: true, items };
}

async function settleOpenBetsForOrder(
  supabase: SupabaseClient,
  orderId: string,
  etaInitial: number,
  actual: number,
  nowIso: string,
): Promise<string | null> {
  const { data: bets, error: bErr } = await supabase.from("bets").select(
    "id, host_id, status, delay_probability",
  ).eq("order_id", orderId).eq("status", "open");
  if (bErr) return bErr.message;
  for (const bet of bets ?? []) {
    const { data: parts, error: pErr } = await supabase.from(
      "bet_participants",
    ).select("id, display_name, side, participant_fingerprint").eq(
      "bet_id",
      bet.id,
    );
    if (pErr) return pErr.message;
    const r = await resolveBetAndParticipants(
      supabase,
      {
        id: bet.id,
        host_id: bet.host_id,
        status: bet.status,
        delay_probability: bet.delay_probability,
      },
      (parts ?? []) as Parameters<
        typeof resolveBetAndParticipants
      >[2],
      { actualMinutes: actual, etaInitialMinutes: etaInitial, nowIso },
    );
    if (!r.ok) return r.error;
  }
  return null;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const sb0 = getServiceSupabase();
    if (!sb0.ok) {
      return json(
        { ok: false, error: { code: sb0.error, message: sb0.error } },
        500,
      );
    }
    const supabase = sb0.supabase;

    const tenMinAgo = new Date(Date.now() - 10 * 60_000).toISOString();
    const nowIso = new Date().toISOString();
    const nowMs = Date.now();

    const { data: orderRows, error: oErr } = await supabase.from("orders")
      .select(`
        id,
        host_id,
        restaurant_name_normalized,
        eta_initial_minutes,
        order_placed_at,
        resolved,
        actual_delivery_minutes,
        gmail_message_id_placed,
        gmail_message_id_enroute,
        gmail_message_id_delivered,
        bets ( id, host_id, status, resolve_deadline_at, delay_probability )
      `)
      .eq("resolved", false)
      .lt("order_placed_at", tenMinAgo);

    if (oErr) {
      return json(
        {
          ok: false,
          error: {
            code: "orders_query_failed",
            message: oErr.message,
          },
        },
        500,
      );
    }

    const orders = (orderRows ?? []) as OrderWithBets[];
    const byHost = new Map<string, OrderWithBets[]>();
    for (const o of orders) {
      const list = byHost.get(o.host_id) ?? [];
      list.push(o);
      byHost.set(o.host_id, list);
    }

    const summary = {
      hosts: byHost.size,
      ordersUpdatedFromGmail: 0,
      ordersCompletedFromPriorActual: 0,
      betsVoided: 0,
      errors: [] as string[],
    };

    const maxOrderAgeMs = 72 * 3600_000;

    for (const [hostId, hostOrders] of byHost) {
      const { data: tokRow, error: tErr } = await supabase.from(
        "google_oauth_tokens",
      ).select("*").eq("host_id", hostId).maybeSingle();

      const gmailActual = new Map<string, { mins: number; msgId: string }>();

      if (tErr || !tokRow) {
        summary.errors.push(`host ${hostId}: oauth_missing`);
      } else {
        const oauth = tokRow as GoogleOAuthRow;
        const token = await ensureHostGmailAccessToken(supabase, oauth);
        if (!token.ok) {
          summary.errors.push(
            `host ${hostId}: token ${token.error}${token.status ?? ""}`,
          );
        } else {
          const deliveries = await fetchDeliveredCandidates(token.accessToken);
          if (!deliveries.ok) {
            summary.errors.push(`host ${hostId}: gmail ${deliveries.error}`);
          } else {
            const usedOrderIds = new Set<string>();
            for (const d of deliveries.items) {
              const pick = pickOrderForDelivery(
                hostOrders,
                d,
                usedOrderIds,
                maxOrderAgeMs,
                (o) => !o.gmail_message_id_delivered,
              );
              if (!pick) continue;
              const mins = actualMinutesBetween(
                pick.order_placed_at,
                d.receivedAt,
              );
              if (mins === null) continue;
              usedOrderIds.add(pick.id);
              gmailActual.set(pick.id, { mins, msgId: d.messageId });
            }
          }
        }
      }

      for (const order of hostOrders) {
        const g = gmailActual.get(order.id);
        const prior = order.actual_delivery_minutes;
        const actual = g?.mins ?? (prior != null ? prior : null);

        if (actual == null) {
          const openBets = (order.bets ?? []).filter((b) => b.status === "open");
          for (const bet of openBets) {
            const deadline = Date.parse(bet.resolve_deadline_at);
            if (Number.isFinite(deadline) && deadline <= nowMs) {
              const v = await voidOpenBet(
                supabase,
                bet.id,
                "resolve_deadline_elapsed_no_delivery_email",
                nowIso,
              );
              if (!v.ok) {
                summary.errors.push(`void ${bet.id}: ${v.error}`);
              } else {
                summary.betsVoided += 1;
              }
            }
          }
          continue;
        }

        const etaInitial = order.eta_initial_minutes;

        if (etaInitial == null) {
          const openBets = (order.bets ?? []).filter((b) => b.status === "open");
          for (const bet of openBets) {
            const v = await voidOpenBet(
              supabase,
              bet.id,
              "missing_eta_initial",
              nowIso,
            );
            if (v.ok) summary.betsVoided += 1;
            else summary.errors.push(`void ${bet.id}: ${v.error}`);
          }
          if (g) {
            const { error: u0 } = await supabase.from("orders").update({
              actual_delivery_minutes: actual,
              gmail_message_id_delivered: g.msgId,
            }).eq("id", order.id);
            if (u0) summary.errors.push(`order ${order.id}: ${u0.message}`);
          }
          const { error: u1 } = await supabase.from("orders").update({
            resolved: true,
            resolved_at: nowIso,
          }).eq("id", order.id);
          if (u1) summary.errors.push(`order ${order.id}: ${u1.message}`);
          continue;
        }

        if (g) {
          const { error: u0 } = await supabase.from("orders").update({
            actual_delivery_minutes: actual,
            gmail_message_id_delivered: g.msgId,
          }).eq("id", order.id);
          if (u0) {
            summary.errors.push(`order ${order.id}: ${u0.message}`);
            continue;
          }
        }

        const settleErr = await settleOpenBetsForOrder(
          supabase,
          order.id,
          etaInitial,
          actual,
          nowIso,
        );
        if (settleErr) {
          summary.errors.push(`settle ${order.id}: ${settleErr}`);
          continue;
        }

        const { error: fin } = await supabase.from("orders").update({
          resolved: true,
          resolved_at: nowIso,
        }).eq("id", order.id);
        if (fin) {
          summary.errors.push(`order ${order.id} finalize: ${fin.message}`);
          continue;
        }

        if (g) summary.ordersUpdatedFromGmail += 1;
        else if (prior != null) summary.ordersCompletedFromPriorActual += 1;
      }
    }

    return json({ ok: true, summary });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return json(
      { ok: false, error: { code: "unhandled", message } },
      500,
    );
  }
});
