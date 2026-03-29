import { decryptUberSessionCookie } from "./uber-session-crypto.ts";

const UBER_ORIGIN = "https://www.ubereats.com";

export type UberSessionRow = {
  cookie_ciphertext: string;
  x_csrf_token: string | null;
  authorization_header: string | null;
};

function extractCsrfToken(cookieString: string): string | undefined {
  const parts = cookieString.split(";").map((s) => s.trim());
  for (const p of parts) {
    const eq = p.indexOf("=");
    if (eq <= 0) continue;
    const name = p.slice(0, eq).trim().toLowerCase();
    const val = p.slice(eq + 1).trim();
    if (!val) continue;
    if (
      name === "csrftoken" ||
      name === "_csrf" ||
      name === "csrf" ||
      name.includes("csrf") ||
      name === "x-csrftoken"
    ) {
      try {
        return decodeURIComponent(val);
      } catch {
        return val;
      }
    }
  }
  return undefined;
}

function headersForSession(
  cookie: string,
  x_csrf_token: string | null,
  authorization_header: string | null,
): Record<string, string> {
  const csrf = (x_csrf_token?.trim() || extractCsrfToken(cookie) || "").trim();
  const h: Record<string, string> = {
    cookie,
    "content-type": "application/json",
    accept: "application/json, text/plain, */*",
    "accept-language": "en-US,en;q=0.9",
    origin: UBER_ORIGIN,
    referer: `${UBER_ORIGIN}/`,
    "user-agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
  };
  if (csrf) h["x-csrf-token"] = csrf;
  if (authorization_header?.trim()) {
    h["authorization"] = authorization_header.trim();
  }
  return h;
}

export async function sessionFromRow(row: UberSessionRow) {
  const cookie_string = await decryptUberSessionCookie(row.cookie_ciphertext);
  return {
    cookie_string,
    headers: headersForSession(
      cookie_string,
      row.x_csrf_token,
      row.authorization_header,
    ),
  };
}

function num(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim()) {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function latLng(obj: unknown): { latitude: number; longitude: number } | null {
  if (!obj || typeof obj !== "object") return null;
  const o = obj as Record<string, unknown>;
  const lat = num(o.latitude ?? o.lat);
  const lng = num(o.longitude ?? o.lng);
  if (lat == null || lng == null) return null;
  return { latitude: lat, longitude: lng };
}

export type LiveOrderStatus = {
  currentStatus: string;
  estimatedArrivalTime: number | null;
  courierLocation: { latitude: number; longitude: number } | null;
  restaurantLocation: { latitude: number; longitude: number } | null;
  deliveryLocation: { latitude: number; longitude: number } | null;
  uberOrderUuid: string | null;
};

export async function fetchActiveOrder(headers: Record<string, string>): Promise<LiveOrderStatus | null> {
  const res = await fetch(`${UBER_ORIGIN}/_p/api/getActiveOrderV1`, {
    method: "GET",
    headers,
  });

  const json = await res.json().catch(() => null);
  if (!res.ok) {
    if (res.status === 404) return null;
    throw new Error(`getActiveOrderV1 ${res.status}`);
  }

  if (!json || typeof json !== "object") return null;
  const root = json as Record<string, unknown>;
  const data = (root.data ?? root.order ?? root.activeOrder ?? root) as Record<string, unknown>;
  if (!data || typeof data !== "object") return null;

  const hasSignal =
    data.currentStatus ||
    data.status ||
    data.courierLocation ||
    data.courier ||
    data.deliveryJobState;
  if (!hasSignal) return null;

  const courierRaw =
    data.courierLocation ??
    (data.courier as Record<string, unknown> | undefined)?.location ??
    data.courierLatLng;

  const restRaw =
    data.restaurantLocation ??
    (data.store as Record<string, unknown> | undefined)?.location ??
    data.pickupLocation;

  const dropRaw =
    data.deliveryLocation ?? data.dropoffLocation ?? data.eaterLocation;

  const etaRaw =
    data.estimatedArrivalTime ??
    data.estimatedDeliveryTime ??
    data.arrivalTime;

  let estimatedArrivalTime: number | null = null;
  if (typeof etaRaw === "number" && Number.isFinite(etaRaw)) {
    estimatedArrivalTime = etaRaw > 1e12 ? etaRaw : etaRaw * 1000;
  } else if (typeof etaRaw === "string") {
    const d = Date.parse(etaRaw);
    if (Number.isFinite(d)) estimatedArrivalTime = d;
  }

  const uuid =
    typeof data.uuid === "string"
      ? data.uuid
      : typeof data.orderUUID === "string"
        ? data.orderUUID
        : typeof data.orderUuid === "string"
          ? data.orderUuid
          : null;

  return {
    currentStatus: String(data.currentStatus ?? data.status ?? "UNKNOWN"),
    estimatedArrivalTime,
    courierLocation: latLng(courierRaw),
    restaurantLocation: latLng(restRaw),
    deliveryLocation: latLng(dropRaw),
    uberOrderUuid: uuid,
  };
}
