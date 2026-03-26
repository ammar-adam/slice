import "server-only";

type LatLng = { lat: number; lng: number };

function clamp(n: number, lo: number, hi: number): number {
  if (!Number.isFinite(n)) return lo;
  return Math.min(hi, Math.max(lo, n));
}

function haversineKm(a: LatLng, b: LatLng): number {
  const R = 6371;
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const x =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  const c = 2 * Math.asin(Math.min(1, Math.sqrt(x)));
  return R * c;
}

// Google encoded polyline decoder (classic algorithm).
export function decodePolyline(encoded: string): LatLng[] {
  const points: LatLng[] = [];
  let index = 0;
  let lat = 0;
  let lng = 0;

  while (index < encoded.length) {
    let b = 0;
    let shift = 0;
    let result = 0;
    do {
      b = encoded.charCodeAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20 && index < encoded.length);
    const dlat = (result & 1) ? ~(result >> 1) : (result >> 1);
    lat += dlat;

    shift = 0;
    result = 0;
    do {
      b = encoded.charCodeAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20 && index < encoded.length);
    const dlng = (result & 1) ? ~(result >> 1) : (result >> 1);
    lng += dlng;

    points.push({ lat: lat / 1e5, lng: lng / 1e5 });
  }

  return points;
}

function resampleWaypoints(path: LatLng[], targetCount: number): LatLng[] {
  if (path.length === 0) return [];
  if (path.length === 1) return [path[0]];
  const count = Math.max(2, Math.floor(targetCount));

  // Compute cumulative distances along path.
  const cum: number[] = [0];
  for (let i = 1; i < path.length; i++) {
    cum.push(cum[i - 1] + haversineKm(path[i - 1], path[i]));
  }
  const total = cum[cum.length - 1];
  if (total <= 0) return [path[0], path[path.length - 1]];

  const out: LatLng[] = [];
  for (let k = 0; k < count; k++) {
    const t = (k / (count - 1)) * total;
    // Find segment containing t.
    let i = 1;
    while (i < cum.length && cum[i] < t) i++;
    if (i >= cum.length) {
      out.push(path[path.length - 1]);
      continue;
    }
    const a = path[i - 1];
    const b = path[i];
    const segStart = cum[i - 1];
    const segEnd = cum[i];
    const segLen = Math.max(1e-9, segEnd - segStart);
    const frac = (t - segStart) / segLen;
    out.push({
      lat: a.lat + (b.lat - a.lat) * frac,
      lng: a.lng + (b.lng - a.lng) * frac,
    });
  }
  return out;
}

function straightLineWaypoints(a: LatLng, b: LatLng, count: number): LatLng[] {
  const n = Math.max(2, Math.floor(count));
  const out: LatLng[] = [];
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    out.push({ lat: a.lat + (b.lat - a.lat) * t, lng: a.lng + (b.lng - a.lng) * t });
  }
  return out;
}

export async function generateDriverPath(params: {
  restaurant_lat: number;
  restaurant_lng: number;
  delivery_lat: number;
  delivery_lng: number;
  eta_minutes: number;
}): Promise<{
  waypoints: Array<{ lat: number; lng: number }>;
  total_distance_km: number;
  encoded_polyline: string;
}> {
  const origin = { lat: params.restaurant_lat, lng: params.restaurant_lng };
  const dest = { lat: params.delivery_lat, lng: params.delivery_lng };
  const fallback = () => {
    const waypoints = straightLineWaypoints(origin, dest, 50);
    const total_distance_km = haversineKm(origin, dest);
    return { waypoints, total_distance_km, encoded_polyline: "" };
  };

  if (
    !Number.isFinite(origin.lat) ||
    !Number.isFinite(origin.lng) ||
    !Number.isFinite(dest.lat) ||
    !Number.isFinite(dest.lng)
  ) {
    return fallback();
  }

  const key = process.env.GOOGLE_MAPS_API_KEY;
  if (!key) {
    return fallback();
  }

  try {
    const url = new URL("https://maps.googleapis.com/maps/api/directions/json");
    url.searchParams.set("origin", `${origin.lat},${origin.lng}`);
    url.searchParams.set("destination", `${dest.lat},${dest.lng}`);
    url.searchParams.set("mode", "driving");
    url.searchParams.set("key", key);

    const res = await fetch(url.toString());
    if (!res.ok) return fallback();
    const json = (await res.json()) as {
      status?: string;
      routes?: Array<{
        overview_polyline?: { points?: string };
        legs?: Array<{ distance?: { value?: number } }>;
      }>;
    };

    const poly = json.routes?.[0]?.overview_polyline?.points;
    if (!poly || typeof poly !== "string") return fallback();
    const decoded = decodePolyline(poly);
    if (decoded.length < 2) return fallback();
    const waypoints = resampleWaypoints(decoded, 50);
    const meters = json.routes?.[0]?.legs?.[0]?.distance?.value;
    const total_distance_km =
      typeof meters === "number" && Number.isFinite(meters) && meters > 0
        ? meters / 1000
        : haversineKm(origin, dest);

    return { waypoints, total_distance_km, encoded_polyline: poly };
  } catch {
    return fallback();
  }
}

export function interpolateDriverPosition(params: {
  waypoints: Array<{ lat: number; lng: number }>;
  eta_minutes: number;
  minutes_elapsed: number;
  pickup_delay_minutes: number;
}): { lat: number; lng: number; progress: number } {
  const waypoints = params.waypoints ?? [];
  if (waypoints.length === 0) {
    return { lat: 0, lng: 0, progress: 0 };
  }
  if (waypoints.length === 1) {
    return { lat: waypoints[0].lat, lng: waypoints[0].lng, progress: 0 };
  }

  const eta = Math.max(1, params.eta_minutes);
  const t = Math.max(0, params.minutes_elapsed - Math.max(0, params.pickup_delay_minutes));
  const progress = clamp(t / eta, 0, 1);

  const idxFloat = progress * (waypoints.length - 1);
  const idx = Math.floor(idxFloat);
  const frac = idxFloat - idx;
  const a = waypoints[Math.min(idx, waypoints.length - 1)];
  const b = waypoints[Math.min(idx + 1, waypoints.length - 1)];
  return {
    lat: a.lat + (b.lat - a.lat) * frac,
    lng: a.lng + (b.lng - a.lng) * frac,
    progress,
  };
}

