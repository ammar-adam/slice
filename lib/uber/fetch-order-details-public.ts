import "server-only";

const UBER_ORIGIN = "https://www.ubereats.com";

const MINIMAL_HEADERS: Record<string, string> = {
  "x-csrf-token": "x",
  "content-type": "application/json",
  accept: "application/json, text/plain, */*",
  "accept-language": "en-US,en;q=0.9",
  origin: UBER_ORIGIN,
  referer: `${UBER_ORIGIN}/`,
  "user-agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
};

export type ParsedOrderDetails = {
  restaurant_name: string | null;
  eta_minutes: number | null;
  order_status: string | null;
  restaurant_lat: number | null;
  restaurant_lng: number | null;
  delivery_lat: number | null;
  delivery_lng: number | null;
  ok: boolean;
  httpStatus: number;
};

function pickString(...candidates: unknown[]): string | undefined {
  for (const c of candidates) {
    if (typeof c === "string" && c.trim()) return c.trim();
  }
  return undefined;
}

function num(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim()) {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function pickDateMs(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) {
    return v > 1e12 ? v : v * 1000;
  }
  if (typeof v === "string" && v.trim()) {
    const n = Number(v);
    if (Number.isFinite(n)) return n > 1e12 ? n : n * 1000;
    const d = Date.parse(v);
    if (Number.isFinite(d)) return d;
  }
  return null;
}

function latLng(obj: unknown): { lat: number; lng: number } | null {
  if (!obj || typeof obj !== "object") return null;
  const o = obj as Record<string, unknown>;
  const lat = num(o.latitude ?? o.lat);
  const lng = num(o.longitude ?? o.lng);
  if (lat == null || lng == null) return null;
  return { lat, lng };
}

function unwrapData(json: unknown): Record<string, unknown> | null {
  if (!json || typeof json !== "object") return null;
  const o = json as Record<string, unknown>;
  const data = o.data ?? o.order ?? o.orderDetails ?? o;
  if (data && typeof data === "object") return data as Record<string, unknown>;
  return null;
}

export function parseOrderDetailsJson(json: unknown): Omit<ParsedOrderDetails, "ok" | "httpStatus"> {
  const root = unwrapData(json);
  if (!root) {
    return {
      restaurant_name: null,
      eta_minutes: null,
      order_status: null,
      restaurant_lat: null,
      restaurant_lng: null,
      delivery_lat: null,
      delivery_lng: null,
    };
  }

  const restaurant_name =
    pickString(
      root.restaurantName,
      (root.store as Record<string, unknown> | undefined)?.title,
      (root.restaurant as Record<string, unknown> | undefined)?.name,
    ) ?? null;

  const order_status =
    pickString(
      root.status,
      root.orderState,
      root.currentStatus,
    )?.toUpperCase() ?? null;

  const etaRaw =
    root.estimatedDeliveryTime ??
    root.estimatedArrivalTime ??
    root.deliveryTime ??
    root.targetDeliveryTime;

  const etaMs = pickDateMs(etaRaw);
  let eta_minutes: number | null = null;
  if (etaMs != null) {
    const diffMin = Math.round((etaMs - Date.now()) / 60_000);
    if (Number.isFinite(diffMin) && diffMin >= 1) {
      eta_minutes = Math.min(240, diffMin);
    }
  }

  const restLoc =
    latLng(root.restaurantLocation) ??
    latLng((root.store as Record<string, unknown> | undefined)?.location) ??
    latLng(root.pickupLocation);

  const dropLoc =
    latLng(root.deliveryLocation) ??
    latLng(root.dropoffLocation) ??
    latLng(root.eaterLocation);

  return {
    restaurant_name,
    eta_minutes,
    order_status,
    restaurant_lat: restLoc?.lat ?? null,
    restaurant_lng: restLoc?.lng ?? null,
    delivery_lat: dropLoc?.lat ?? null,
    delivery_lng: dropLoc?.lng ?? null,
  };
}

export async function fetchUberOrderDetailsPublic(
  orderUuid: string,
): Promise<ParsedOrderDetails> {
  const getUrl = `${UBER_ORIGIN}/_p/api/getOrderDetailsV1?orderUuid=${encodeURIComponent(orderUuid)}`;
  let res = await fetch(getUrl, { method: "GET", headers: MINIMAL_HEADERS });
  let json: unknown = await res.json().catch(() => null);

  if (res.status === 401 || res.status === 403) {
    const postRes = await fetch(`${UBER_ORIGIN}/_p/api/getOrderDetailsV1`, {
      method: "POST",
      headers: MINIMAL_HEADERS,
      body: JSON.stringify({ orderUuid }),
    });
    res = postRes;
    json = await postRes.json().catch(() => null);
  }

  if (res.status === 401 || res.status === 403) {
    return {
      restaurant_name: null,
      eta_minutes: null,
      order_status: null,
      restaurant_lat: null,
      restaurant_lng: null,
      delivery_lat: null,
      delivery_lng: null,
      ok: false,
      httpStatus: res.status,
    };
  }

  const parsed = parseOrderDetailsJson(json);
  const hasAnySignal =
    parsed.restaurant_name != null ||
    parsed.eta_minutes != null ||
    parsed.order_status != null;

  if (!res.ok) {
    return {
      ...parsed,
      ok: hasAnySignal,
      httpStatus: res.status,
    };
  }

  return {
    ...parsed,
    ok: hasAnySignal,
    httpStatus: res.status,
  };
}
