import { NextResponse } from "next/server";
import { z } from "zod";

import { getSession } from "@/lib/auth/session";
import { ensureHostByNextAuthUserId, getHostIdByNextAuthUserId } from "@/lib/hosts/lookup";
import { calculateDelayScore } from "@/lib/model/v1-weighted";
import { normalizeRestaurantName } from "@/lib/orders/normalize";
import { listRecentOrdersForHost } from "@/lib/orders/queries";
import { createBetSlug } from "@/lib/slug";
import { createAdminClient } from "@/lib/supabase/admin";
import { initMarket } from "@/lib/market/lmsr";
import { generateDriverPath } from "@/lib/tracking/driver-path";

const createBodySchema = z.object({
  restaurantName: z.string().min(1).max(200),
  etaMinutes: z.coerce.number().int().min(1).max(240),
  dareText: z.string().max(500).optional().nullable(),
});

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

  const { restaurantName, etaMinutes, dareText } = parsed.data;
  const name = restaurantName.trim();
  const dare =
    dareText?.trim() && dareText.trim().length > 0 ? dareText.trim() : null;

  const hostId = await ensureHostByNextAuthUserId({
    nextauthUserId: session.user.id,
    email: session.user.email ?? null,
  });

  const placedAt = new Date();
  const placedIso = placedAt.toISOString();
  const restaurantCoords = await geocodeRestaurant(name);
  // Demo: delivery location is fixed (Waterloo city hall-ish) unless user location exists.
  const deliveryCoords = { lat: 43.4643, lng: -80.5204 };
  const restaurantLat = restaurantCoords?.lat ?? 0;
  const restaurantLng = restaurantCoords?.lng ?? 0;
  const predictBase =
    process.env.PYTHON_API_URL ??
    (process.env.NODE_ENV === "development"
      ? "http://localhost:3001"
      : process.env.NEXTAUTH_URL ?? new URL(req.url).origin);
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

  const resolveDeadline = new Date(
    placedAt.getTime() + etaMinutes * 60_000 + 180 * 60_000
  );

  const supabase = createAdminClient();

  const { data: orderRow, error: orderError } = await supabase
    .from("orders")
    .insert({
      host_id: hostId,
      platform: "unknown",
      restaurant_name: name,
      restaurant_name_normalized: normalizeRestaurantName(name),
      eta_initial_minutes: etaMinutes,
      order_placed_at: placedIso,
      delay_score: delayScore,
      distance_km: null,
    })
    .select("id")
    .single();

  if (orderError || !orderRow) {
    console.error("orders insert", orderError);
    return NextResponse.json({ error: "Failed to create order" }, { status: 500 });
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
      betError.code === "23505"
    ) {
      continue;
    }

    console.error("bets insert", betError);
    await supabase.from("orders").delete().eq("id", orderId);
    return NextResponse.json({ error: "Failed to create bet" }, { status: 500 });
  }

  if (!publicSlug) {
    await supabase.from("orders").delete().eq("id", orderId);
    return NextResponse.json({ error: "Could not allocate slug" }, { status: 500 });
  }

  return NextResponse.json({ slug: publicSlug });
}
