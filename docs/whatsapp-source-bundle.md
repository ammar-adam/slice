# WhatsApp integration source bundle

This file is machine-split by `tools/split_whatsapp_bundle.py` (run from repo root).

<!-- FILE: lib/whatsapp/client.ts -->
~~~ts
import "server-only";

/**
 * Sends a plain-text WhatsApp message via Meta Graph API.
 * Never throws — logs errors and returns false on failure.
 */
export async function sendWhatsAppMessage(to: string, text: string): Promise<boolean> {
  const token = process.env.WHATSAPP_ACCESS_TOKEN;
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  if (!token || !phoneNumberId) {
    console.error("sendWhatsAppMessage: missing WHATSAPP_ACCESS_TOKEN or WHATSAPP_PHONE_NUMBER_ID");
    return false;
  }

  const url = `https://graph.facebook.com/v18.0/${phoneNumberId}/messages`;
  const body = {
    messaging_product: "whatsapp",
    to,
    type: "text",
    text: { body: text },
  };

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      console.error("sendWhatsAppMessage: Graph API error", res.status, errText.slice(0, 500));
      return false;
    }
    return true;
  } catch (e) {
    console.error("sendWhatsAppMessage: fetch failed", e);
    return false;
  }
}
~~~

<!-- FILE: lib/whatsapp/verify-signature.ts -->
~~~ts
import "server-only";

import * as crypto from "crypto";

/**
 * Verifies Meta X-Hub-Signature-256 header against raw webhook body.
 */
export function verifyWebhookSignature(
  rawBody: string,
  signatureHeader: string | null,
  appSecret: string
): boolean {
  if (!signatureHeader || !appSecret || typeof rawBody !== "string") return false;
  const prefix = "sha256=";
  if (!signatureHeader.startsWith(prefix)) return false;
  const theirHex = signatureHeader.slice(prefix.length).trim();
  if (!/^[a-f0-9]{64}$/i.test(theirHex)) return false;
  const expected = crypto.createHmac("sha256", appSecret).update(rawBody, "utf8").digest("hex");
  try {
    return crypto.timingSafeEqual(Buffer.from(theirHex, "hex"), Buffer.from(expected, "hex"));
  } catch {
    return false;
  }
}
~~~

<!-- FILE: lib/whatsapp/parse-inbound.ts -->
~~~ts
import "server-only";

export type InboundWhatsAppText = {
  wa_id: string;
  phone: string | null;
  message_id: string;
  text: string;
  timestamp: string | null;
};

function readString(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const s = v.trim();
  return s.length ? s : null;
}

/**
 * Parses Meta WhatsApp Cloud API webhook JSON for a single inbound user text message.
 */
export function parseWhatsAppWebhook(body: unknown): InboundWhatsAppText | null {
  if (!body || typeof body !== "object") return null;
  const root = body as Record<string, unknown>;
  const entry = root.entry;
  if (!Array.isArray(entry) || entry.length === 0) return null;

  for (const ent of entry) {
    if (!ent || typeof ent !== "object") continue;
    const changes = (ent as Record<string, unknown>).changes;
    if (!Array.isArray(changes)) continue;
    for (const ch of changes) {
      if (!ch || typeof ch !== "object") continue;
      const value = (ch as Record<string, unknown>).value;
      if (!value || typeof value !== "object") continue;
      const messages = (value as Record<string, unknown>).messages;
      if (!Array.isArray(messages) || messages.length === 0) continue;
      const msg = messages[0];
      if (!msg || typeof msg !== "object") continue;
      const m = msg as Record<string, unknown>;
      if (m.type !== "text") return null;
      const from = readString(m.from);
      if (!from) return null;
      const id = readString(m.id);
      if (!id) return null;
      const textObj = m.text;
      let textBody = "";
      if (textObj && typeof textObj === "object") {
        const tb = readString((textObj as Record<string, unknown>).body);
        if (tb) textBody = tb;
      }
      if (!textBody) return null;
      const ts = readString(m.timestamp);
      const contacts = (value as Record<string, unknown>).contacts;
      let phone: string | null = null;
      if (Array.isArray(contacts)) {
        for (const c of contacts) {
          if (!c || typeof c !== "object") continue;
          const wa = readString((c as Record<string, unknown>).wa_id);
          if (wa === from) {
            const profile = (c as Record<string, unknown>).profile as Record<string, unknown> | undefined;
            phone = profile ? readString(profile.name) : null;
            break;
          }
        }
      }
      return {
        wa_id: from,
        phone,
        message_id: id,
        text: textBody,
        timestamp: ts,
      };
    }
  }
  return null;
}
~~~

<!-- FILE: lib/whatsapp/conversation-state.ts -->
~~~ts
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
~~~

<!-- FILE: lib/whatsapp/magic-link.ts -->
~~~ts
import "server-only";

import * as crypto from "crypto";

function timingSafeEqualString(a: string, b: string): boolean {
  try {
    const ab = Buffer.from(a, "utf8");
    const bb = Buffer.from(b, "utf8");
    if (ab.length !== bb.length) return false;
    return crypto.timingSafeEqual(ab, bb);
  } catch {
    return false;
  }
}

export function signWaMagicLink(wa_id: string, orderUuid: string, secret: string): string {
  return crypto.createHmac("sha256", secret).update(`${wa_id}|${orderUuid}`).digest("base64url");
}

export function verifyWaMagicLink(wa_id: string, orderUuid: string, sig: string, secret: string): boolean {
  if (!sig || sig.length > 400 || !wa_id || !orderUuid || !secret) return false;
  const expected = signWaMagicLink(wa_id, orderUuid, secret);
  return timingSafeEqualString(expected, sig);
}

export function getWhatsAppMagicSecret(): string | null {
  return process.env.WHATSAPP_INTERNAL_SECRET?.trim() || null;
}
~~~

<!-- FILE: lib/whatsapp/send-bet-ready.ts -->
~~~ts
import "server-only";

import { sendWhatsAppMessage } from "./client";

export function betReadyMessage(slug: string): string {
  const base = (
    process.env.NEXT_PUBLIC_APP_URL ??
    process.env.NEXTAUTH_URL ??
    "https://slice.app"
  ).replace(/\/$/, "");
  return (
    `Your bet is ready! Share with friends:\n` +
    `${base}/bet/${slug}\n\n` +
    `Text ARRIVED when food shows up.`
  );
}

export async function sendBetReadyWhatsApp(wa_id: string, slug: string): Promise<boolean> {
  return sendWhatsAppMessage(wa_id, betReadyMessage(slug));
}
~~~

<!-- FILE: lib/hosts/lookup-whatsapp.ts -->
~~~ts
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
~~~

<!-- FILE: lib/orders/create-bet-from-input.ts -->
~~~ts
import "server-only";

import { calculateDelayScore } from "@/lib/model/v1-weighted";
import { initMarket } from "@/lib/market/lmsr";
import { normalizeRestaurantName } from "@/lib/orders/normalize";
import { createBetSlug } from "@/lib/slug";
import { createAdminClient } from "@/lib/supabase/admin";
import { generateDriverPath } from "@/lib/tracking/driver-path";

export type CreateBetFromParsedParams = {
  host_id: string;
  restaurant_name: string;
  eta_minutes: number;
  dare_text?: string | null;
  uber_order_uuid?: string | null;
  delivery_address?: string | null;
  /** Origin used when PYTHON_API_URL is unset (e.g. request URL origin). */
  predictOrigin: string;
};

async function geocodeRestaurant(name: string): Promise<{ lat: number; lng: number } | null> {
  const key = process.env.GOOGLE_MAPS_API_KEY;
  if (!key) return null;
  try {
    const url = new URL("https://maps.googleapis.com/maps/api/geocode/json");
    url.searchParams.set("address", `${name} Waterloo ON`);
    url.searchParams.set("key", key);
    const res = await fetch(url.toString());
    if (!res.ok) return null;
    const json = (await res.json()) as {
      status?: string;
      results?: Array<{ geometry?: { location?: { lat?: number; lng?: number } } }>;
    };
    const loc = json.results?.[0]?.geometry?.location;
    if (!loc || typeof loc.lat !== "number" || typeof loc.lng !== "number") return null;
    if (!Number.isFinite(loc.lat) || !Number.isFinite(loc.lng)) return null;
    return { lat: loc.lat, lng: loc.lng };
  } catch {
    return null;
  }
}

export async function createBetFromParsed(
  params: CreateBetFromParsedParams
): Promise<{ slug: string; order_id: string }> {
  const {
    host_id: hostId,
    restaurant_name: rawName,
    eta_minutes: etaMinutes,
    dare_text: dareText,
    uber_order_uuid: uberUuidRaw,
    delivery_address: deliveryAddress,
    predictOrigin,
  } = params;

  const name = rawName.trim();
  const dare =
    dareText != null && String(dareText).trim().length > 0 ? String(dareText).trim().slice(0, 500) : null;
  const uberUuid =
    typeof uberUuidRaw === "string" && uberUuidRaw.trim().length > 0 ? uberUuidRaw.trim() : null;

  const placedAt = new Date();
  const placedIso = placedAt.toISOString();
  const restaurantCoords = await geocodeRestaurant(name);
  const deliveryCoords = { lat: 43.4643, lng: -80.5204 };
  const restaurantLat = restaurantCoords?.lat ?? 0;
  const restaurantLng = restaurantCoords?.lng ?? 0;
  const predictBase =
    process.env.PYTHON_API_URL ??
    (process.env.NODE_ENV === "development"
      ? "http://localhost:3001"
      : predictOrigin.replace(/\/$/, ""));
  const predictUrl = `${predictBase.replace(/\/$/, "")}/api/predict`;
  const delayScoreRes = await fetch(predictUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      restaurant_name: name,
      eta_initial_minutes: etaMinutes,
      placed_at_iso: placedIso,
      lat: deliveryCoords.lat,
      lng: deliveryCoords.lng,
      restaurant_lat: restaurantLat,
      restaurant_lng: restaurantLng,
    }),
  }).then((r) => r.json().catch(() => null));
  const delayScore =
    delayScoreRes && delayScoreRes.ok === true && typeof delayScoreRes.delay_probability === "number"
      ? delayScoreRes.delay_probability
      : await calculateDelayScore({
          restaurant_name: name,
          eta_initial_minutes: etaMinutes,
          placed_at: placedAt,
          lat: deliveryCoords.lat,
          lng: deliveryCoords.lng,
          restaurant_lat: restaurantLat,
          restaurant_lng: restaurantLng,
        });

  const resolveDeadline = new Date(placedAt.getTime() + etaMinutes * 60_000 + 180 * 60_000);

  const supabase = createAdminClient();

  const orderInsert: Record<string, unknown> = {
    host_id: hostId,
    platform: uberUuid ? "uber_eats" : "unknown",
    restaurant_name: name,
    restaurant_name_normalized: normalizeRestaurantName(name),
    eta_initial_minutes: etaMinutes,
    order_placed_at: placedIso,
    delay_score: delayScore,
    distance_km: null,
  };
  if (uberUuid) orderInsert.uber_order_uuid = uberUuid;
  if (deliveryAddress != null && String(deliveryAddress).trim()) {
    orderInsert.delivery_address_summary = String(deliveryAddress).trim().slice(0, 500);
  }

  const { data: orderRow, error: orderError } = await supabase
    .from("orders")
    .insert(orderInsert)
    .select("id")
    .single();

  if (orderError || !orderRow) {
    console.error("orders insert", orderError);
    throw new Error("Failed to create order");
  }

  const orderId = orderRow.id as string;

  if (restaurantCoords) {
    const path = await generateDriverPath({
      restaurant_lat: restaurantCoords.lat,
      restaurant_lng: restaurantCoords.lng,
      delivery_lat: deliveryCoords.lat,
      delivery_lng: deliveryCoords.lng,
      eta_minutes: etaMinutes,
    });
    await (supabase as any).from("order_driver_paths").upsert({
        order_id: orderId,
        restaurant_lat: restaurantCoords.lat,
        restaurant_lng: restaurantCoords.lng,
        delivery_lat: deliveryCoords.lat,
        delivery_lng: deliveryCoords.lng,
        waypoints: path.waypoints,
        encoded_polyline: path.encoded_polyline || null,
        total_distance_km: path.total_distance_km,
      });
  }

  let publicSlug: string | null = null;
  for (let attempt = 0; attempt < 8; attempt++) {
    const slugTry = createBetSlug();
    const { data: betRow, error: betError } = await supabase
      .from("bets")
      .insert({
        public_slug: slugTry,
        host_id: hostId,
        order_id: orderId,
        dare_text: dare,
        delay_probability: delayScore,
        status: "open",
        resolve_deadline_at: resolveDeadline.toISOString(),
      })
      .select("id, public_slug")
      .single();

    if (!betError && betRow) {
      publicSlug = betRow.public_slug as string;
      const betId = betRow.id as string;
      const market = initMarket({ prior: delayScore, liquidity: 80 });
      await (supabase as any).from("bet_markets").upsert({ bet_id: betId, lmsr_state: market });
      break;
    }

    if (
      betError &&
      typeof betError === "object" &&
      "code" in betError &&
      (betError as { code: string }).code === "23505"
    ) {
      continue;
    }

    console.error("bets insert", betError);
    await supabase.from("orders").delete().eq("id", orderId);
    throw new Error("Failed to create bet");
  }

  if (!publicSlug) {
    await supabase.from("orders").delete().eq("id", orderId);
    throw new Error("Could not allocate slug");
  }

  return { slug: publicSlug, order_id: orderId };
}
~~~

<!-- FILE: lib/whatsapp/message-router.ts -->
~~~ts
import "server-only";

import { ensureHostForWhatsApp } from "@/lib/hosts/lookup-whatsapp";
import { createBetFromParsed } from "@/lib/orders/create-bet-from-input";
import { createAdminClient } from "@/lib/supabase/admin";
import { extractUberOrderUuidFromUrl } from "@/lib/uber/extract-order-uuid";
import { fetchUberOrderDetailsPublic } from "@/lib/uber/fetch-order-details-public";
import { clearState, getState, setState } from "@/lib/whatsapp/conversation-state";
import { getWhatsAppMagicSecret, signWaMagicLink } from "@/lib/whatsapp/magic-link";

function minutesBetween(a: Date, b: Date): number {
  const ms = b.getTime() - a.getTime();
  if (!Number.isFinite(ms)) return 0;
  return Math.max(0, Math.round(ms / 60_000));
}

function appBaseUrl(): string {
  return (
    process.env.NEXT_PUBLIC_APP_URL ??
    process.env.NEXTAUTH_URL ??
    "https://slice.app"
  ).replace(/\/$/, "");
}

const HELP_TEXT =
  `Slice on WhatsApp:\n` +
  `• Paste your Uber Eats order link (looks like ubereats.com/orders/…)\n` +
  `• I’ll create a bet and send a slice.app link to share\n` +
  `• Friends pick Over/Under on the web\n` +
  `• Text ARRIVED when food shows up\n` +
  `• STATUS — open bets · CANCEL — void current bet\n` +
  `Reply HELP anytime.`;

const UBER_URL_HINT =
  `Send me your Uber Eats order link and I’ll set up the bet. It looks like:\n` +
  `https://www.ubereats.com/orders/… (your order id in the URL).`;

async function voidOpenOrder(orderId: string): Promise<{ ok: true } | { ok: false; message: string }> {
  const supabase = createAdminClient();
  const nowIso = new Date().toISOString();

  const { data: betRows, error: bErr } = await supabase
    .from("bets")
    .select("id,status")
    .eq("order_id", orderId)
    .eq("status", "open");

  if (bErr) {
    return { ok: false, message: "Could not look up bets to void." };
  }

  for (const b of betRows ?? []) {
    const betId = String((b as { id?: unknown }).id ?? "");
    if (!betId) continue;
    await supabase.from("bet_participants").update({ is_correct: null, points_delta: null }).eq("bet_id", betId);
    await supabase
      .from("bets")
      .update({
        status: "void",
        voided_at: nowIso,
        void_reason: "host_void:cancelled",
      })
      .eq("id", betId);
  }

  const { error: oErr } = await supabase.from("orders").update({ resolved: true, resolved_at: nowIso }).eq("id", orderId);

  if (oErr) {
    return { ok: false, message: "Could not void order." };
  }
  return { ok: true };
}

async function getLatestOpenBetForHost(hostId: string): Promise<{
  bet_slug: string;
  order_id: string;
  order_placed_at: string;
} | null> {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("bets")
    .select("public_slug, order_id, orders!inner(order_placed_at)")
    .eq("host_id", hostId)
    .eq("status", "open")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error || !data) return null;
  const row = data as {
    public_slug?: unknown;
    order_id?: unknown;
    orders?: { order_placed_at?: unknown } | { order_placed_at?: unknown }[];
  };
  const slug = typeof row.public_slug === "string" ? row.public_slug : null;
  const oid = typeof row.order_id === "string" ? row.order_id : null;
  const orders = row.orders;
  const placed =
    orders && !Array.isArray(orders) && typeof (orders as { order_placed_at?: unknown }).order_placed_at === "string"
      ? String((orders as { order_placed_at: string }).order_placed_at)
      : null;
  if (!slug || !oid || !placed) return null;
  return { bet_slug: slug, order_id: oid, order_placed_at: placed };
}

async function listOpenBetsLines(hostId: string): Promise<string> {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("bets")
    .select("public_slug, orders!inner(restaurant_name)")
    .eq("host_id", hostId)
    .eq("status", "open")
    .order("created_at", { ascending: false })
    .limit(10);

  if (error || !data?.length) {
    return "You have no open bets right now. Paste an Uber Eats order link to start one.";
  }
  const lines: string[] = ["Your open bets:"];
  let i = 1;
  for (const row of data as { public_slug?: string; orders?: { restaurant_name?: string } }[]) {
    const slug = row.public_slug ?? "?";
    const name =
      row.orders && typeof row.orders === "object" && "restaurant_name" in row.orders
        ? String((row.orders as { restaurant_name?: string }).restaurant_name ?? "Restaurant")
        : "Restaurant";
    lines.push(`${i}. ${name} — ${appBaseUrl()}/bet/${slug}`);
    i += 1;
  }
  return lines.join("\n");
}

async function handleAwaitingDare(
  wa_id: string,
  hostId: string,
  trimmed: string,
  lower: string
): Promise<string> {
  if (lower === "cancel" || lower === "void" || lower === "abort") {
    await clearState(wa_id);
    return "Okay — I cancelled that bet setup. Paste a new Uber Eats link whenever you’re ready.";
  }

  const st = await getState(wa_id);
  const ctx = st.context;
  const restaurant = typeof ctx.restaurant_name === "string" ? ctx.restaurant_name : "";
  const eta = typeof ctx.eta_minutes === "number" ? ctx.eta_minutes : Number(ctx.eta_minutes);
  const uuid = typeof ctx.uber_order_uuid === "string" ? ctx.uber_order_uuid : null;
  if (!restaurant || !Number.isFinite(eta) || eta < 1 || !uuid) {
    await clearState(wa_id);
    return "Something got out of sync. Paste your Uber Eats order link again to restart.";
  }

  let dare: string | null = null;
  if (lower === "skip" || lower === "no" || lower === "none") {
    dare = null;
  } else {
    dare = trimmed.slice(0, 500);
    if (!dare.length) {
      return "Add a dare (short text) or reply SKIP to create the bet without one.";
    }
  }

  try {
    const { slug } = await createBetFromParsed({
      host_id: hostId,
      restaurant_name: restaurant,
      eta_minutes: Math.round(eta),
      dare_text: dare,
      uber_order_uuid: uuid,
      predictOrigin: appBaseUrl(),
    });
    await clearState(wa_id);
    return (
      `Bet created!\n` +
      `Share with friends: ${appBaseUrl()}/bet/${slug}\n\n` +
      `Text ARRIVED when the food shows up.`
    );
  } catch (e) {
    console.error("handleAwaitingDare create", e);
    await clearState(wa_id);
    return "Could not create the bet just now. Try again in a minute or use the web app at slice.app/create.";
  }
}

/**
 * Main WhatsApp text router. Returns the outbound reply body.
 */
export async function route(wa_id: string, text: string): Promise<string> {
  const trimmed = text.trim();
  if (!trimmed) {
    return `I didn’t catch that — try again, or reply HELP.\n${UBER_URL_HINT}`;
  }

  const lower = trimmed.toLowerCase();
  const hostId = await ensureHostForWhatsApp(wa_id);

  let convo = await getState(wa_id);
  if (convo.state === "awaiting_dare") {
    const maybeUuid = extractUberOrderUuidFromUrl(trimmed);
    if (maybeUuid) {
      await clearState(wa_id);
      convo = { state: "idle", context: {} };
    } else {
      return handleAwaitingDare(wa_id, hostId, trimmed, lower);
    }
  }

  if (lower === "help" || lower === "?") {
    return HELP_TEXT;
  }

  if (lower === "status") {
    return listOpenBetsLines(hostId);
  }

  if (lower === "arrived" || lower === "here" || lower === "food here") {
    const bet = await getLatestOpenBetForHost(hostId);
    if (!bet) {
      return "No open bet to resolve. Paste an Uber Eats order link to start one, or reply STATUS.";
    }
    const placedAt = new Date(bet.order_placed_at);
    const actualMinutes = minutesBetween(placedAt, new Date());
    const supabase = createAdminClient();
    const { error } = await supabase.functions.invoke("resolve-bets", {
      body: {
        order_id: bet.order_id,
        actual_minutes: actualMinutes,
        source: "manual",
      },
    });
    if (error) {
      console.error("resolve-bets invoke", error);
      return "Could not resolve the bet right now. Try again in a moment, or use the bet page on the web.";
    }
    return (
      `Marked arrived (${actualMinutes} min).\n` +
      `Results: ${appBaseUrl()}/result/${bet.bet_slug}\n\n` +
      `Thanks for playing Slice.`
    );
  }

  if (lower === "cancel" || lower === "void") {
    const bet = await getLatestOpenBetForHost(hostId);
    if (!bet) {
      return "No open bet to cancel. Reply STATUS to see your bets.";
    }
    const v = await voidOpenOrder(bet.order_id);
    if (!v.ok) {
      return v.message;
    }
    return `Voided your current bet (${bet.bet_slug}). Paste a new Uber Eats link anytime.`;
  }

  const uuid = extractUberOrderUuidFromUrl(trimmed);
  if (!uuid) {
    if (/https?:\/\//i.test(trimmed)) {
      return `That doesn’t look like an Uber Eats order link.\n${UBER_URL_HINT}`;
    }
    return `Not sure what to do with that. ${HELP_TEXT}`;
  }

  const fetched = await fetchUberOrderDetailsPublic(uuid);
  const authBlocked = fetched.httpStatus === 401 || fetched.httpStatus === 403;
  const hasName = fetched.restaurant_name != null && fetched.restaurant_name.length > 0;
  const hasEta = fetched.eta_minutes != null && fetched.eta_minutes >= 1;
  const completeFromApi = hasName && hasEta && !authBlocked && fetched.ok;
  const needsManualInput = authBlocked || !completeFromApi;

  if (needsManualInput) {
    const secret = getWhatsAppMagicSecret();
    if (!secret) {
      return (
        `Couldn’t auto-detect your order details from Uber.\n` +
        `Our team needs to configure the app — try again later, or open slice.app/create while signed in.`
      );
    }
    const sig = signWaMagicLink(wa_id, uuid, secret);
    const link =
      `${appBaseUrl()}/create?phone=${encodeURIComponent(wa_id)}` +
      `&uuid=${encodeURIComponent(uuid)}` +
      `&sig=${encodeURIComponent(sig)}`;
    return (
      `Couldn’t auto-detect your order details.\n` +
      `Tap to fill them in (takes ~10 seconds):\n` +
      link
    );
  }

  await setState(wa_id, "awaiting_dare", {
    restaurant_name: fetched.restaurant_name as string,
    eta_minutes: fetched.eta_minutes as number,
    uber_order_uuid: uuid,
  });

  return (
    `Got it — ${fetched.restaurant_name}, ETA ${fetched.eta_minutes} min.\n\n` +
    `Add a dare? Reply with it or say SKIP.`
  );
}
~~~

<!-- FILE: app/api/webhooks/whatsapp/route.ts -->
~~~ts
import { NextResponse } from "next/server";

import { ensureHostForWhatsApp } from "@/lib/hosts/lookup-whatsapp";
import { createAdminClient } from "@/lib/supabase/admin";
import { parseWhatsAppWebhook } from "@/lib/whatsapp/parse-inbound";
import { route } from "@/lib/whatsapp/message-router";
import { sendWhatsAppMessage } from "@/lib/whatsapp/client";
import { verifyWebhookSignature } from "@/lib/whatsapp/verify-signature";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const mode = url.searchParams.get("hub.mode");
  const token = url.searchParams.get("hub.verify_token");
  const challenge = url.searchParams.get("hub.challenge");
  const expected = process.env.WHATSAPP_VERIFY_TOKEN;
  if (mode === "subscribe" && token && expected && token === expected && challenge) {
    return new NextResponse(challenge, { status: 200 });
  }
  return new NextResponse("Forbidden", { status: 403 });
}

export async function POST(req: Request) {
  const secret = process.env.WHATSAPP_APP_SECRET;
  const rawBody = await req.text();
  const sig = req.headers.get("x-hub-signature-256");

  if (!secret || !verifyWebhookSignature(rawBody, sig, secret)) {
    return new NextResponse("Forbidden", { status: 403 });
  }

  let json: unknown;
  try {
    json = JSON.parse(rawBody);
  } catch {
    return new NextResponse("ok", { status: 200 });
  }

  const inbound = parseWhatsAppWebhook(json);
  if (!inbound) {
    return new NextResponse("ok", { status: 200 });
  }

  const supabase = createAdminClient();
  const { error: insErr } = await supabase.from("whatsapp_inbound_messages").insert({
    message_id: inbound.message_id,
    wa_id: inbound.wa_id,
    body: inbound.text,
  });

  if (insErr) {
    if (typeof insErr === "object" && "code" in insErr && (insErr as { code: string }).code === "23505") {
      return new NextResponse("ok", { status: 200 });
    }
    console.error("whatsapp_inbound_messages insert", insErr);
  }

  try {
    await ensureHostForWhatsApp(inbound.wa_id);
    const reply = await route(inbound.wa_id, inbound.text);
    await sendWhatsAppMessage(inbound.wa_id, reply);
  } catch (e) {
    console.error("whatsapp webhook handler", e);
    try {
      await sendWhatsAppMessage(
        inbound.wa_id,
        `Something went wrong on our side. Please try again in a minute, or reply HELP.`
      );
    } catch (_) {
      /* ignore */
    }
  }

  return new NextResponse("ok", { status: 200 });
}
~~~

<!-- FILE: app/api/internal/whatsapp/notify/route.ts -->
~~~ts
import { NextResponse } from "next/server";
import { z } from "zod";

import { sendBetReadyWhatsApp } from "@/lib/whatsapp/send-bet-ready";

const bodySchema = z.object({
  wa_id: z.string().min(1).max(64),
  bet_slug: z.string().min(4).max(40),
});

function authorize(req: Request): boolean {
  const secret = process.env.WHATSAPP_INTERNAL_SECRET?.trim();
  if (!secret) return false;
  const h = req.headers.get("authorization") ?? "";
  const prefix = "Bearer ";
  if (!h.startsWith(prefix)) return false;
  return h.slice(prefix.length).trim() === secret;
}

export async function POST(req: Request) {
  if (!authorize(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid body", issues: parsed.error.flatten() }, { status: 400 });
  }

  const ok = await sendBetReadyWhatsApp(parsed.data.wa_id, parsed.data.bet_slug.trim().toLowerCase());
  if (!ok) {
    return NextResponse.json({ error: "Failed to send WhatsApp message" }, { status: 502 });
  }
  return NextResponse.json({ ok: true });
}
~~~

<!-- FILE: app/api/internal/orders/wa-complete/route.ts -->
~~~ts
import { NextResponse } from "next/server";
import { z } from "zod";

import { createBetFromParsed } from "@/lib/orders/create-bet-from-input";
import { ensureHostForWhatsApp } from "@/lib/hosts/lookup-whatsapp";
import { verifyWaMagicLink, getWhatsAppMagicSecret } from "@/lib/whatsapp/magic-link";
import { sendBetReadyWhatsApp } from "@/lib/whatsapp/send-bet-ready";

const bodySchema = z.object({
  wa_id: z.string().min(1).max(64),
  uuid: z.string().uuid(),
  restaurantName: z.string().min(1).max(200),
  etaMinutes: z.coerce.number().int().min(1).max(240),
  dareText: z.string().max(500).optional().nullable(),
  sig: z.string().min(1).max(500),
});

function appBaseUrl(): string {
  return (
    process.env.NEXT_PUBLIC_APP_URL ??
    process.env.NEXTAUTH_URL ??
    "https://slice.app"
  ).replace(/\/$/, "");
}

export async function POST(req: Request) {
  const secret = getWhatsAppMagicSecret();
  if (!secret) {
    return NextResponse.json({ error: "Server misconfigured" }, { status: 500 });
  }

  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid body", issues: parsed.error.flatten() }, { status: 400 });
  }

  const { wa_id, uuid, restaurantName, etaMinutes, dareText, sig } = parsed.data;
  if (!verifyWaMagicLink(wa_id, uuid, sig, secret)) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 403 });
  }

  const hostId = await ensureHostForWhatsApp(wa_id);
  const dare =
    dareText != null && String(dareText).trim().length > 0 ? String(dareText).trim().slice(0, 500) : null;

  try {
    const { slug } = await createBetFromParsed({
      host_id: hostId,
      restaurant_name: restaurantName.trim(),
      eta_minutes: etaMinutes,
      dare_text: dare,
      uber_order_uuid: uuid,
      predictOrigin: appBaseUrl(),
    });
    await sendBetReadyWhatsApp(wa_id, slug);
    return NextResponse.json({ slug });
  } catch (e) {
    console.error("wa-complete", e);
    return NextResponse.json({ error: "Failed to create bet" }, { status: 500 });
  }
}
~~~

<!-- FILE: app/api/internal/orders/route.ts -->
~~~ts
import { NextResponse } from "next/server";
import { z } from "zod";

import { getSession } from "@/lib/auth/session";
import { ensureHostByNextAuthUserId, getHostIdByNextAuthUserId } from "@/lib/hosts/lookup";
import { createBetFromParsed } from "@/lib/orders/create-bet-from-input";
import { listRecentOrdersForHost } from "@/lib/orders/queries";
import { verifyWaMagicLink, getWhatsAppMagicSecret } from "@/lib/whatsapp/magic-link";
import { sendBetReadyWhatsApp } from "@/lib/whatsapp/send-bet-ready";

const createBodySchema = z.object({
  restaurantName: z.string().min(1).max(200),
  etaMinutes: z.coerce.number().int().min(1).max(240),
  dareText: z.string().max(500).optional().nullable(),
  uberOrderUuid: z.string().uuid().optional().nullable(),
  notifyWaId: z.string().min(1).max(64).optional(),
  notifySig: z.string().min(1).max(500).optional(),
});

export async function GET() {
  const session = await getSession();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const hostId = await getHostIdByNextAuthUserId(session.user.id);
  if (!hostId) {
    return NextResponse.json({ orders: [] });
  }

  const orders = await listRecentOrdersForHost(hostId, 10);
  return NextResponse.json({ orders });
}

export async function POST(req: Request) {
  const session = await getSession();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = createBodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid body", issues: parsed.error.flatten() }, { status: 400 });
  }

  const { restaurantName, etaMinutes, dareText, uberOrderUuid, notifyWaId, notifySig } = parsed.data;
  const name = restaurantName.trim();
  const dare =
    dareText?.trim() && dareText.trim().length > 0 ? dareText.trim() : null;
  const uberUuid =
    typeof uberOrderUuid === "string" && uberOrderUuid.trim().length > 0
      ? uberOrderUuid.trim()
      : null;

  const hostId = await ensureHostByNextAuthUserId({
    nextauthUserId: session.user.id,
    email: session.user.email ?? null,
  });

  const predictOrigin = new URL(req.url).origin;

  let slug: string;
  try {
    const out = await createBetFromParsed({
      host_id: hostId,
      restaurant_name: name,
      eta_minutes: etaMinutes,
      dare_text: dare,
      uber_order_uuid: uberUuid,
      predictOrigin,
    });
    slug = out.slug;
  } catch (e) {
    console.error("createBetFromParsed", e);
    return NextResponse.json({ error: "Failed to create bet" }, { status: 500 });
  }

  let whatsapp_sent = false;
  const nw = notifyWaId?.trim();
  const ns = notifySig?.trim();
  const secret = getWhatsAppMagicSecret();
  if (nw && ns && uberUuid && secret && verifyWaMagicLink(nw, uberUuid, ns, secret)) {
    whatsapp_sent = await sendBetReadyWhatsApp(nw, slug);
  }

  return NextResponse.json({ slug, whatsapp_sent });
}
~~~

<!-- FILE: app/create/page.tsx -->
~~~tsx
import Link from "next/link";
import { redirect } from "next/navigation";

import { CreateFromUberLinkForm } from "@/components/bets/create-from-uber-link-form";
import { getSession } from "@/lib/auth/session";
import { verifyWaMagicLink, getWhatsAppMagicSecret } from "@/lib/whatsapp/magic-link";

type SP = { [key: string]: string | string[] | undefined };

function first(s: string | string[] | undefined): string | undefined {
  if (Array.isArray(s)) return s[0];
  return typeof s === "string" ? s : undefined;
}

export default async function CreateBetPage(props: { searchParams: SP }) {
  const phone = first(props.searchParams.phone);
  const uuid = first(props.searchParams.uuid);
  const sig = first(props.searchParams.sig);
  const secret = getWhatsAppMagicSecret();
  const magicOk =
    Boolean(phone && uuid && sig && secret && verifyWaMagicLink(phone, uuid, sig, secret));

  const session = await getSession();
  if (!session?.user?.id && !magicOk) {
    redirect("/");
  }

  return (
    <main className="slice-page">
      <header className="mb-6 flex items-center justify-between">
        <Link href={magicOk ? "/" : "/home"} className="slice-logo text-[26px] leading-none">
          slice
        </Link>
      </header>
      <CreateFromUberLinkForm
        magicAuth={magicOk}
        waNotify={
          magicOk && phone && sig && uuid
            ? { waId: phone, sig, uuid }
            : undefined
        }
      />
    </main>
  );
}
~~~

<!-- FILE: components/bets/create-from-uber-link-form.tsx -->
~~~tsx
"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

type ParseResponse = {
  uuid: string;
  restaurant_name: string | null;
  eta_minutes: number | null;
  status: string | null;
  needs_manual_input: boolean;
  error?: string;
};

type WaNotify = { waId: string; sig: string; uuid: string };

export function CreateFromUberLinkForm(props: {
  magicAuth?: boolean;
  waNotify?: WaNotify;
}) {
  const router = useRouter();
  const { magicAuth = false, waNotify } = props;
  const [step, setStep] = useState<"url" | "confirm">("url");
  const [orderUrl, setOrderUrl] = useState("");
  const [parsed, setParsed] = useState<ParseResponse | null>(null);
  const [restaurantName, setRestaurantName] = useState("");
  const [etaMinutes, setEtaMinutes] = useState("");
  const [showDare, setShowDare] = useState(false);
  const [dareText, setDareText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [magicSuccess, setMagicSuccess] = useState<string | null>(null);

  useEffect(() => {
    if (!waNotify?.uuid) return;
    const syntheticUrl = `https://www.ubereats.com/orders/${waNotify.uuid}`;
    setOrderUrl(syntheticUrl);
    setBusy(true);
    void (async () => {
      try {
        const res = await fetch("/api/internal/uber/parse-order", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ order_url: syntheticUrl, uuid: waNotify.uuid }),
        });
        const data = (await res.json().catch(() => ({}))) as ParseResponse & { error?: string };
        if (!res.ok) {
          setError(typeof data.error === "string" ? data.error : "Could not read order link");
          setBusy(false);
          return;
        }
        setParsed({
          uuid: data.uuid,
          restaurant_name: data.restaurant_name,
          eta_minutes: data.eta_minutes,
          status: data.status,
          needs_manual_input: data.needs_manual_input,
        });
        setRestaurantName(data.restaurant_name ?? "");
        setEtaMinutes(
          data.eta_minutes != null && data.eta_minutes > 0 ? String(data.eta_minutes) : "",
        );
        setStep("confirm");
      } finally {
        setBusy(false);
      }
    })();
  }, [waNotify?.uuid, waNotify]);

  async function onParseSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const url = orderUrl.trim();
    if (url.length < 10) {
      setError("Paste a full Uber Eats order link.");
      return;
    }

    setBusy(true);
    try {
      const res = await fetch("/api/internal/uber/parse-order", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ order_url: url }),
      });
      const data = (await res.json().catch(() => ({}))) as ParseResponse & {
        error?: string;
      };

      if (!res.ok) {
        setError(typeof data.error === "string" ? data.error : "Could not read order link");
        return;
      }

      if (!data.uuid) {
        setError("Invalid response from server");
        return;
      }

      setParsed({
        uuid: data.uuid,
        restaurant_name: data.restaurant_name,
        eta_minutes: data.eta_minutes,
        status: data.status,
        needs_manual_input: data.needs_manual_input,
      });

      setRestaurantName(data.restaurant_name ?? "");
      setEtaMinutes(
        data.eta_minutes != null && data.eta_minutes > 0 ? String(data.eta_minutes) : "",
      );
      setStep("confirm");
    } finally {
      setBusy(false);
    }
  }

  async function onConfirmSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const name = restaurantName.trim();
    const eta = Number(etaMinutes);
    if (!name) {
      setError("Restaurant name is required.");
      return;
    }
    if (!Number.isFinite(eta) || eta < 1 || eta > 240) {
      setError("ETA must be between 1 and 240 minutes.");
      return;
    }
    if (!parsed?.uuid) {
      setError("Missing order id — go back and paste the link again.");
      return;
    }

    setBusy(true);
    try {
      if (magicAuth && waNotify) {
        const res = await fetch("/api/internal/orders/wa-complete", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            wa_id: waNotify.waId,
            uuid: parsed.uuid,
            restaurantName: name,
            etaMinutes: eta,
            dareText: dareText.trim() || null,
            sig: waNotify.sig,
          }),
        });
        const data = (await res.json().catch(() => ({}))) as { slug?: string; error?: string };
        if (!res.ok || !data.slug) {
          setError(typeof data.error === "string" ? data.error : "Failed to create bet");
          return;
        }
        setMagicSuccess("Bet created! Check your WhatsApp for the share link.");
        return;
      }

      const body: Record<string, unknown> = {
        restaurantName: name,
        etaMinutes: eta,
        dareText: dareText.trim() || null,
        uberOrderUuid: parsed.uuid,
      };
      if (waNotify?.waId && waNotify.sig && parsed.uuid) {
        body.notifyWaId = waNotify.waId;
        body.notifySig = waNotify.sig;
      }

      const res = await fetch("/api/internal/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = (await res.json().catch(() => ({}))) as {
        slug?: string;
        error?: string;
        whatsapp_sent?: boolean;
      };
      if (!res.ok || !data.slug) {
        setError(typeof data.error === "string" ? data.error : "Failed to create bet");
        return;
      }
      if (data.whatsapp_sent) {
        setMagicSuccess("Bet created! Check your WhatsApp for the share link.");
        return;
      }
      router.push(`/bet/${data.slug}`);
    } finally {
      setBusy(false);
    }
  }

  if (magicSuccess) {
    return (
      <div className="slice-card slice-fade-up space-y-4 p-6 text-center">
        <p className="slice-heading text-2xl">You&apos;re set</p>
        <p className="text-sm" style={{ color: "var(--slice-muted)" }}>
          {magicSuccess}
        </p>
      </div>
    );
  }

  if (step === "confirm" && parsed) {
    return (
      <form onSubmit={(e) => void onConfirmSubmit(e)} className="slice-card slice-fade-up space-y-4 p-4">
        <p className="slice-heading text-2xl">Confirm your bet</p>
        <p className="text-sm" style={{ color: "var(--slice-muted)" }}>
          Order {parsed.uuid.slice(0, 8)}…
          {parsed.status ? ` · ${parsed.status}` : null}
        </p>

        {parsed.needs_manual_input ? (
          <>
            <p className="text-sm" style={{ color: "var(--slice-muted)" }}>
              We couldn&apos;t load details from Uber automatically. Enter them below.
            </p>
            <div>
              <label className="slice-heading mb-2 block text-xl">Restaurant name</label>
              <input
                required
                value={restaurantName}
                onChange={(e) => setRestaurantName(e.target.value)}
                className="slice-input w-full px-3 py-3"
                placeholder="e.g. Jinya Ramen"
              />
            </div>
            <div>
              <label className="slice-heading mb-2 block text-xl">ETA (minutes)</label>
              <input
                required
                type="number"
                min={1}
                max={240}
                value={etaMinutes}
                onChange={(e) => setEtaMinutes(e.target.value)}
                className="slice-input w-full px-3 py-3"
              />
            </div>
          </>
        ) : (
          <div className="slice-card space-y-2 p-4" style={{ background: "var(--slice-surface2)" }}>
            <p>
              <span className="text-sm" style={{ color: "var(--slice-muted)" }}>
                Restaurant
              </span>
              <br />
              <span className="text-lg">{restaurantName || "—"}</span>
            </p>
            <p>
              <span className="text-sm" style={{ color: "var(--slice-muted)" }}>
                ETA
              </span>
              <br />
              <span className="text-lg">
                {etaMinutes ? `${etaMinutes} min` : "—"}
              </span>
            </p>
          </div>
        )}

        <div>
          <button
            type="button"
            className="slice-btn-secondary mb-2 flex items-center gap-2 px-3 py-2 text-sm"
            onClick={() => setShowDare((v) => !v)}
          >
            + dare (optional)
          </button>
          {showDare ? (
            <textarea
              value={dareText}
              onChange={(e) => setDareText(e.target.value)}
              className="slice-input w-full resize-none px-3 py-3"
              rows={3}
              placeholder="Loser buys garlic knots"
            />
          ) : null}
        </div>

        {error ? (
          <p className="text-sm" style={{ color: "var(--slice-red)" }}>
            {error}
          </p>
        ) : null}

        <div className="flex flex-col gap-2 sm:flex-row">
          <button
            type="button"
            className="slice-btn-secondary w-full px-4 py-3"
            disabled={busy}
            onClick={() => {
              setStep("url");
              setParsed(null);
              setError(null);
            }}
          >
            Back
          </button>
          <button type="submit" disabled={busy} className="slice-btn-primary w-full px-4 py-[14px]">
            {busy ? "Creating…" : "Create bet →"}
          </button>
        </div>
      </form>
    );
  }

  if (magicAuth && waNotify && busy && !parsed) {
    return (
      <div className="slice-card slice-fade-up space-y-4 p-6 text-center">
        <p className="text-sm" style={{ color: "var(--slice-muted)" }}>
          Loading your order from Uber…
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={(e) => void onParseSubmit(e)} className="slice-card slice-fade-up space-y-4 p-4">
      <div>
        <label className="slice-heading mb-2 block text-2xl">Paste your Uber Eats order link</label>
        <input
          required
          value={orderUrl}
          onChange={(e) => setOrderUrl(e.target.value)}
          className="slice-input w-full px-3 py-3 font-mono text-sm"
          placeholder="https://www.ubereats.com/orders/..."
          autoComplete="off"
        />
      </div>

      {error ? (
        <p className="text-sm" style={{ color: "var(--slice-red)" }}>
          {error}
        </p>
      ) : null}

      <button type="submit" disabled={busy} className="slice-btn-primary w-full px-4 py-[14px]">
        {busy ? "Looking up order…" : "Continue"}
      </button>
    </form>
  );
}
~~~

<!-- FILE: .env.example -->
~~~env
# App
NEXTAUTH_URL=http://localhost:3000
NEXTAUTH_SECRET=

# Google OAuth (NextAuth + Gmail)
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=

# Supabase (service role for server + Edge orchestration; never expose to client)
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=

# Optional 32-byte key (base64) for Uber session cookie encryption; defaults to SHA-256(SUPABASE_SERVICE_ROLE_KEY)
UBER_SESSION_ENCRYPTION_KEY=

# Feature flags (server-side parsers / ingest)
ENABLE_DOORDASH=false
ENABLE_SKIP=false

# Google Maps (Distance Matrix)
GOOGLE_MAPS_API_KEY=

# Python API (local Vercel Python runtime)
PYTHON_API_URL=http://localhost:3001

# WhatsApp Cloud API (Meta)
WHATSAPP_ACCESS_TOKEN=
WHATSAPP_PHONE_NUMBER_ID=
WHATSAPP_APP_SECRET=
WHATSAPP_VERIFY_TOKEN=slice-webhook-2024

# Shared secret: magic-link HMAC (phone+uuid on /create) + Bearer auth for POST /api/internal/whatsapp/notify
WHATSAPP_INTERNAL_SECRET=
~~~

<!-- FILE: types/database.ts -->
~~~ts
/**
 * Minimal Supabase schema typing for compile-time safety.
 * Regenerate from CLI when schema stabilizes: `supabase gen types typescript`
 */
export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  public: {
    Tables: {
      hosts: {
        Row: {
          id: string;
          nextauth_user_id: string;
          google_sub: string | null;
          email: string | null;
          display_name: string | null;
          whatsapp_wa_id: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          nextauth_user_id: string;
          google_sub?: string | null;
          email?: string | null;
          display_name?: string | null;
          whatsapp_wa_id?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["hosts"]["Insert"]>;
        Relationships: [];
      };
      google_oauth_tokens: {
        Row: {
          host_id: string;
          refresh_token: string;
          access_token: string | null;
          access_token_expires_at: string | null;
          scopes: string[];
          updated_at: string;
        };
        Insert: {
          host_id: string;
          refresh_token: string;
          access_token?: string | null;
          access_token_expires_at?: string | null;
          scopes: string[];
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["google_oauth_tokens"]["Insert"]>;
        Relationships: [];
      };
      uber_sessions: {
        Row: {
          host_id: string;
          cookie_ciphertext: string;
          x_csrf_token: string | null;
          authorization_header: string | null;
          validated_at: string;
          expires_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          host_id: string;
          cookie_ciphertext: string;
          x_csrf_token?: string | null;
          authorization_header?: string | null;
          validated_at?: string;
          expires_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["uber_sessions"]["Insert"]>;
        Relationships: [];
      };
      whatsapp_identities: {
        Row: { wa_id: string; host_id: string; created_at: string };
        Insert: { wa_id: string; host_id: string; created_at?: string };
        Update: Partial<Database["public"]["Tables"]["whatsapp_identities"]["Insert"]>;
        Relationships: [];
      };
      whatsapp_inbound_messages: {
        Row: { message_id: string; wa_id: string; body: string | null; created_at: string };
        Insert: { message_id: string; wa_id: string; body?: string | null; created_at?: string };
        Update: Partial<Database["public"]["Tables"]["whatsapp_inbound_messages"]["Insert"]>;
        Relationships: [];
      };
      whatsapp_conversation_state: {
        Row: { wa_id: string; state: string; context_json: Json; updated_at: string };
        Insert: { wa_id: string; state?: string; context_json?: Json; updated_at?: string };
        Update: Partial<Database["public"]["Tables"]["whatsapp_conversation_state"]["Insert"]>;
        Relationships: [];
      };
      orders: {
        Row: {
          id: string;
          host_id: string;
          restaurant_name_normalized: string;
          resolved: boolean;
          order_placed_at: string;
          [key: string]: unknown;
        };
        Insert: Record<string, unknown>;
        Update: Record<string, unknown>;
        Relationships: [];
      };
      restaurant_priors: {
        Row: {
          id: string;
          restaurant_name_normalized: string;
          late_rate_prior: number;
          mention_count: number;
          source: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          restaurant_name_normalized: string;
          late_rate_prior: number;
          mention_count?: number;
          source: string;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["restaurant_priors"]["Insert"]>;
        Relationships: [];
      };
      bets: {
        Row: Record<string, unknown>;
        Insert: Record<string, unknown>;
        Update: Record<string, unknown>;
        Relationships: [];
      };
      bet_participants: {
        Row: Record<string, unknown>;
        Insert: Record<string, unknown>;
        Update: Record<string, unknown>;
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: {
      get_bet_by_slug: { Args: { p_slug: string }; Returns: Json | null };
      get_restaurant_ranking_summaries: {
        Args: Record<string, never>;
        Returns: {
          restaurant_name_normalized: string;
          display_name: string;
          resolved_order_count: number;
        }[];
      };
    };
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};
~~~

