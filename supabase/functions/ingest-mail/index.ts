import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { corsHeaders } from "../_shared/cors.ts";
import {
  detectPlatformFromHeaders,
  detectUberEatsEmailType,
  parseUberEatsForIngest,
} from "../_shared/uber-eats-parser.ts";
import {
  ensureHostGmailAccessToken,
  getHeader,
  getMessageBodyText,
  getMessageFull,
  getGmailHistoryId,
  listMessageIds,
  messageInternalDate,
  type GoogleOAuthRow,
  UBER_EATS_GMAIL_QUERY_30D,
} from "../_shared/gmail.ts";
import type { GmailMessage } from "../_shared/gmail.ts";
import { getServiceSupabase, requireServiceRoleAuth } from "../_shared/supabase.ts";
import {
  normalizeRestaurantKey,
  pickOrderForDelivery,
  type DeliveryCandidate,
  type UnresolvedOrderRow,
} from "../_shared/orders.ts";

const parser_version = 1;

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "content-type": "application/json" },
  });
}

async function hostMessageExists(
  supabase: SupabaseClient,
  hostId: string,
  gmailId: string,
): Promise<boolean> {
  const { data, error } = await supabase.from("orders").select("id").eq(
    "host_id",
    hostId,
  ).or(
    `gmail_message_id_placed.eq.${gmailId},gmail_message_id_enroute.eq.${gmailId},gmail_message_id_delivered.eq.${gmailId}`,
  ).maybeSingle();
  if (error) return true;
  return data != null;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const auth = requireServiceRoleAuth(req);
    if (!auth.ok) {
      return json(
        { ok: false, error: { code: auth.error, message: auth.error } },
        auth.status,
      );
    }

    if (req.method !== "POST") {
      return json(
        {
          ok: false,
          error: { code: "method_not_allowed", message: "Use POST" },
        },
        405,
      );
    }

    let body: { host_id?: string };
    try {
      body = await req.json();
    } catch {
      return json(
        {
          ok: false,
          error: { code: "invalid_json", message: "Body must be JSON" },
        },
        400,
      );
    }

    const hostId = body.host_id?.trim();
    if (!hostId) {
      return json(
        {
          ok: false,
          error: { code: "missing_host_id", message: "`host_id` required" },
        },
        400,
      );
    }

    const sb0 = getServiceSupabase();
    if (!sb0.ok) {
      return json(
        { ok: false, error: { code: sb0.error, message: sb0.error } },
        500,
      );
    }
    const supabase = sb0.supabase;

    const { data: tokRow, error: tErr } = await supabase.from(
      "google_oauth_tokens",
    ).select("*").eq("host_id", hostId).maybeSingle();

    if (tErr || !tokRow) {
      return json(
        {
          ok: false,
          error: {
            code: "oauth_not_found",
            message: "No Google tokens for this host",
          },
        },
        400,
      );
    }

    const oauth = tokRow as GoogleOAuthRow;
    const token = await ensureHostGmailAccessToken(supabase, oauth);
    if (!token.ok) {
      return json(
        {
          ok: false,
          error: {
            code: "token_refresh_failed",
            message: token.error,
            status: token.status,
          },
        },
        502,
      );
    }

    const listed = await listMessageIds(token.accessToken, UBER_EATS_GMAIL_QUERY_30D);
    if (!listed.ok) {
      return json(
        {
          ok: false,
          error: { code: "gmail_list_failed", message: listed.error },
        },
        502,
      );
    }

    const uniqueIds = [...new Set(listed.ids)];
    const hydrated: { id: string; msg: GmailMessage }[] = [];
    for (const id of uniqueIds) {
      const got = await getMessageFull(token.accessToken, id);
      if (!got.ok) continue;
      if (!got.message.id) continue;
      hydrated.push({ id: got.message.id, msg: got.message });
    }

    hydrated.sort((a, b) =>
      messageInternalDate(a.msg).getTime() -
      messageInternalDate(b.msg).getTime()
    );

    const { data: existingOrders, error: loErr } = await supabase.from(
      "orders",
    ).select(`
        id,
        host_id,
        restaurant_name_normalized,
        eta_initial_minutes,
        order_placed_at,
        resolved,
        actual_delivery_minutes,
        gmail_message_id_placed,
        gmail_message_id_enroute,
      gmail_message_id_delivered
      `).eq("host_id", hostId).eq("resolved", false);

    if (loErr) {
      return json(
        {
          ok: false,
          error: { code: "orders_load_failed", message: loErr.message },
        },
        500,
      );
    }

    const localOrders: UnresolvedOrderRow[] = [
      ...(existingOrders ?? []),
    ] as UnresolvedOrderRow[];

    const usedDelivered = new Set<string>();
    const maxOrderAgeMs = 72 * 3600_000;

    const summary = {
      messages_seen: hydrated.length,
      skipped_duplicate_gmail: 0,
      skipped_non_uber: 0,
      skipped_unknown_kind: 0,
      placed: 0,
      enroute: 0,
      delivered: 0,
      errors: [] as string[],
    };

    for (const { id: msgId, msg } of hydrated) {
      if (await hostMessageExists(supabase, hostId, msgId)) {
        summary.skipped_duplicate_gmail += 1;
        continue;
      }

      const from = getHeader(msg, "From");
      const subject = getHeader(msg, "Subject");
      if (detectPlatformFromHeaders({ from, subject }) !== "uber_eats") {
        summary.skipped_non_uber += 1;
        continue;
      }

      const bodyText = getMessageBodyText(msg);
      const kind = detectUberEatsEmailType(bodyText);
      if (kind === "unknown") {
        summary.skipped_unknown_kind += 1;
        continue;
      }

      const receivedAt = messageInternalDate(msg);

      if (kind === "placed") {
        const draft = parseUberEatsForIngest(bodyText, receivedAt);
        if (!draft || draft.kind !== "placed") continue;

        const norm = normalizeRestaurantKey(draft.restaurantName);
        const orderPlacedAt = draft.orderPlacedAt ?? receivedAt;

        const { data: inserted, error: insErr } = await supabase.from("orders")
          .insert({
            host_id: hostId,
            platform: "uber_eats",
            restaurant_name: draft.restaurantName,
            restaurant_name_normalized: norm,
            eta_initial_minutes: draft.etaInitialMinutes ?? null,
            order_placed_at: orderPlacedAt.toISOString(),
            gmail_message_id_placed: msgId,
            parser_version,
            raw_parser_debug: { kind: "placed", gmail_id: msgId },
          }).select(`
            id,
            host_id,
            restaurant_name_normalized,
            eta_initial_minutes,
            order_placed_at,
            resolved,
            actual_delivery_minutes,
            gmail_message_id_placed,
            gmail_message_id_enroute,
            gmail_message_id_delivered
          `).single();

        if (insErr || !inserted) {
          summary.errors.push(`placed ${msgId}: ${insErr?.message ?? "insert"}`);
          continue;
        }
        localOrders.push(inserted as UnresolvedOrderRow);
        summary.placed += 1;
        continue;
      }

      if (kind === "enroute") {
        const draftEarly = parseUberEatsForIngest(bodyText, receivedAt);
        if (!draftEarly || draftEarly.kind !== "enroute") continue;
        const norm = normalizeRestaurantKey(draftEarly.restaurantName);
        const cand: DeliveryCandidate = {
          messageId: msgId,
          receivedAt,
          restaurantNorm: norm,
        };
        const match = pickOrderForDelivery(
          localOrders,
          cand,
          new Set(),
          maxOrderAgeMs,
          (o) => !o.gmail_message_id_enroute,
        );
        if (!match) {
          summary.errors.push(`enroute_orphan ${msgId}`);
          continue;
        }

        const { error: upErr } = await supabase.from("orders").update({
          eta_final_minutes: draftEarly.etaFinalMinutes ?? null,
          gmail_message_id_enroute: msgId,
          raw_parser_debug: { kind: "enroute", gmail_id: msgId },
        }).eq("id", match.id);

        if (upErr) {
          summary.errors.push(`enroute ${msgId}: ${upErr.message}`);
          continue;
        }

        const idx = localOrders.findIndex((r) => r.id === match.id);
        if (idx >= 0) {
          localOrders[idx] = {
            ...localOrders[idx],
            eta_final_minutes: draftEarly.etaFinalMinutes ?? null,
            gmail_message_id_enroute: msgId,
          } as UnresolvedOrderRow;
        }
        summary.enroute += 1;
        continue;
      }

      if (kind === "delivered") {
        const pre = parseUberEatsForIngest(bodyText, receivedAt);
        if (!pre || pre.kind !== "delivered") continue;

        const cand: DeliveryCandidate = {
          messageId: msgId,
          receivedAt,
          restaurantNorm: normalizeRestaurantKey(pre.restaurantName),
        };
        const match = pickOrderForDelivery(
          localOrders,
          cand,
          usedDelivered,
          maxOrderAgeMs,
          (o) => !o.gmail_message_id_delivered,
        );
        if (!match) {
          summary.errors.push(`delivered_orphan ${msgId}`);
          continue;
        }

        const orderPlacedAt = new Date(match.order_placed_at);
        const draft = parseUberEatsForIngest(
          bodyText,
          receivedAt,
          orderPlacedAt,
        );
        if (!draft || draft.kind !== "delivered") continue;

        const actual = draft.actualDeliveryMinutes ?? null;
        if (actual == null) {
          summary.errors.push(`delivered_no_actual ${msgId}`);
          continue;
        }

        usedDelivered.add(match.id);

        const { error: upErr } = await supabase.from("orders").update({
          actual_delivery_minutes: actual,
          gmail_message_id_delivered: msgId,
          raw_parser_debug: { kind: "delivered", gmail_id: msgId },
        }).eq("id", match.id);

        if (upErr) {
          summary.errors.push(`delivered ${msgId}: ${upErr.message}`);
          continue;
        }

        const idx = localOrders.findIndex((r) => r.id === match.id);
        if (idx >= 0) {
          localOrders[idx] = {
            ...localOrders[idx],
            actual_delivery_minutes: actual,
            gmail_message_id_delivered: msgId,
          } as UnresolvedOrderRow;
        }
        summary.delivered += 1;
      }
    }

    const hist = await getGmailHistoryId(token.accessToken);
    if (hist.ok) {
      const { error: syncErr } = await supabase.from("gmail_sync_state").upsert({
        host_id: hostId,
        history_id: hist.historyId,
        last_synced_at: new Date().toISOString(),
      }, { onConflict: "host_id" });
      if (syncErr) {
        summary.errors.push(`sync_state: ${syncErr.message}`);
      }
    } else {
      summary.errors.push(`profile: ${hist.error}`);
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
