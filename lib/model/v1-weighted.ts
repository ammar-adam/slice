import "server-only";

import { getDay, getHours, getMinutes } from "date-fns";

import { getDrivingDistance } from "@/lib/enrich/distance-matrix";
import { getWeatherAtTime } from "@/lib/enrich/open-meteo";
import { normalizeRestaurantName } from "@/lib/orders/normalize";
import { createAdminClient } from "@/lib/supabase/admin";

/** 1.0 Fri/Sat 6–9pm or any day 11pm–2am; 0.7 lunch 12–1:30pm; 0.3 otherwise */
function timeOfDayFactor(placedAt: Date): number {
  const dow = getDay(placedAt);
  const h = getHours(placedAt);
  const m = getMinutes(placedAt);

  const lateNight = h >= 23 || h < 2;
  const friSatPeak =
    (dow === 5 || dow === 6) && h >= 18 && h < 21;
  if (friSatPeak || lateNight) return 1.0;

  const lunch = h === 12 || (h === 13 && m <= 30);
  if (lunch) return 0.7;

  return 0.3;
}

async function restaurantHistoryFactor(restaurantNameNormalized: string): Promise<number> {
  try {
    const supabase = createAdminClient();

    const [countResult, priorResult] = await Promise.all([
      supabase
        .from("orders")
        .select("*", { count: "exact", head: true })
        .eq("restaurant_name_normalized", restaurantNameNormalized)
        .eq("resolved", true),
      supabase
        .from("restaurant_priors")
        .select("late_rate_prior")
        .eq("restaurant_name_normalized", restaurantNameNormalized)
        .maybeSingle(),
    ]);

    const resolvedCount = countResult.count ?? 0;
    if (resolvedCount < 5) return 0.5;

    const prior = priorResult.data?.late_rate_prior;
    if (typeof prior === "number" && Number.isFinite(prior)) {
      return Math.min(1, Math.max(0, prior));
    }
    return 0.5;
  } catch {
    return 0.5;
  }
}

export async function calculateDelayScore(params: {
  restaurant_name: string;
  eta_initial_minutes: number;
  placed_at: Date;
  lat: number;
  lng: number;
  restaurant_lat: number;
  restaurant_lng: number;
}): Promise<number> {
  try {
    void params.eta_initial_minutes;

    const normalized = normalizeRestaurantName(params.restaurant_name);

    const [weather, driving, history] = await Promise.all([
      getWeatherAtTime(params.lat, params.lng, params.placed_at),
      getDrivingDistance(
        params.restaurant_lat,
        params.restaurant_lng,
        params.lat,
        params.lng
      ),
      restaurantHistoryFactor(normalized),
    ]);

    const timeOfDay = timeOfDayFactor(params.placed_at);
    const weatherFactor = Math.min(weather.precip_mm_hr / 5, 1.0);
    const distanceFactor = Math.min(driving.distance_km / 5, 1.0);

    const score =
      0.3 * timeOfDay +
      0.25 * weatherFactor +
      0.2 * distanceFactor +
      0.25 * history;

    return Math.min(1, Math.max(0, score));
  } catch {
    return 0.5;
  }
}
