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
  if (lower === "help") {
    return HELP_TEXT;
  }
  if (lower === "status") {
    await clearState(wa_id);
    return listOpenBetsLines(hostId);
  }
  if (lower === "cancel") {
    await clearState(wa_id);
    return "Bet creation cancelled.";
  }
  if (lower === "void" || lower === "abort") {
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
