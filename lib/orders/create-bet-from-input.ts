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
