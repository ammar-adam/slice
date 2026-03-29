import "server-only";

import { normalizeRestaurantName } from "@/lib/orders/normalize";
import type { ParsedUberOrder, UberSession } from "@/lib/uber/types";

const UBER_ORIGIN = "https://www.ubereats.com";

export function extractCsrfToken(cookieString: string): string | undefined {
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

export function getUberHeaders(session: UberSession): Record<string, string> {
  const csrf =
    session.x_csrf_token?.trim() ||
    extractCsrfToken(session.cookie_string) ||
    "";
  const h: Record<string, string> = {
    cookie: session.cookie_string,
    "content-type": "application/json",
    accept: "application/json, text/plain, */*",
    "accept-language": "en-US,en;q=0.9",
    origin: UBER_ORIGIN,
    referer: `${UBER_ORIGIN}/`,
    "user-agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
  };
  if (csrf) {
    h["x-csrf-token"] = csrf;
  }
  if (session.authorization_header?.trim()) {
    h["authorization"] = session.authorization_header.trim();
  }
  return h;
}

function pickString(...candidates: unknown[]): string | undefined {
  for (const c of candidates) {
    if (typeof c === "string" && c.trim()) return c.trim();
  }
  return undefined;
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

export function parseUberOrderNode(raw: Record<string, unknown>): ParsedUberOrder | null {
  const uuid =
    pickString(raw.uuid, raw.orderUUID, raw.orderUuid, raw.id) ?? "";
  if (!uuid) return null;

  const restaurantName =
    pickString(
      raw.restaurantName,
      (raw.store as Record<string, unknown> | undefined)?.title,
      (raw.restaurant as Record<string, unknown> | undefined)?.name,
    ) ?? "Unknown restaurant";

  const placedMs =
    pickDateMs(raw.orderTime) ??
    pickDateMs(raw.placedAt) ??
    pickDateMs(raw.createdAt) ??
    Date.now();

  const estMs =
    pickDateMs(raw.estimatedDeliveryTime) ??
    pickDateMs(raw.estimatedReadyForPickupTime) ??
    null;

  const delMs = pickDateMs(raw.deliveryTime) ?? pickDateMs(raw.completedAt);

  const status = String(raw.status ?? raw.orderState ?? "UNKNOWN").toUpperCase();

  return {
    uuid,
    restaurantName,
    orderPlacedAt: new Date(placedMs),
    estimatedDeliveryTime: estMs != null ? new Date(estMs) : null,
    deliveryTime: delMs != null ? new Date(delMs) : null,
    status,
  };
}

function extractOrderArray(json: unknown): Record<string, unknown>[] {
  if (!json || typeof json !== "object") return [];
  const o = json as Record<string, unknown>;
  const candidates = [
    o.orders,
    o.data,
    o.orderList,
    o.pastOrders,
    (o.data as Record<string, unknown> | undefined)?.orders,
  ];
  for (const c of candidates) {
    if (Array.isArray(c)) {
      return c.filter((x): x is Record<string, unknown> =>
        !!x && typeof x === "object"
      ) as Record<string, unknown>[];
    }
    if (c && typeof c === "object" && Array.isArray((c as { items?: unknown }).items)) {
      return ((c as { items: unknown[] }).items).filter((x): x is Record<string, unknown> =>
        !!x && typeof x === "object"
      ) as Record<string, unknown>[];
    }
  }
  return [];
}

export async function getPastOrders(
  session: UberSession,
  limit = 10,
): Promise<ParsedUberOrder[]> {
  const res = await fetch(`${UBER_ORIGIN}/_p/api/getPastOrdersV1`, {
    method: "POST",
    headers: getUberHeaders(session),
    body: JSON.stringify({ orderType: "ALL" }),
  });

  const json = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error(
      typeof (json as { message?: string })?.message === "string"
        ? (json as { message: string }).message
        : `getPastOrdersV1 failed: ${res.status}`,
    );
  }

  const rows = extractOrderArray(json);
  const out: ParsedUberOrder[] = [];
  for (const row of rows) {
    const p = parseUberOrderNode(row);
    if (p) out.push(p);
    if (out.length >= limit) break;
  }
  return out;
}

export function toOrderRowFields(p: ParsedUberOrder, hostId: string) {
  const etaInitial =
    p.estimatedDeliveryTime != null
      ? Math.max(
        1,
        Math.round(
          (p.estimatedDeliveryTime.getTime() - p.orderPlacedAt.getTime()) / 60_000,
        ),
      )
      : null;

  const actual =
    p.deliveryTime != null
      ? Math.max(
        0,
        Math.round(
          (p.deliveryTime.getTime() - p.orderPlacedAt.getTime()) / 60_000,
        ),
      )
      : null;

  const resolved = p.status === "DELIVERED" || actual != null;

  return {
    host_id: hostId,
    platform: "uber_eats" as const,
    restaurant_name: p.restaurantName,
    restaurant_name_normalized: normalizeRestaurantName(p.restaurantName),
    eta_initial_minutes: etaInitial,
    eta_final_minutes: etaInitial,
    actual_delivery_minutes: actual,
    order_placed_at: p.orderPlacedAt.toISOString(),
    resolved,
    resolved_at: resolved ? (p.deliveryTime ?? new Date()).toISOString() : null,
    uber_order_uuid: p.uuid,
  };
}
