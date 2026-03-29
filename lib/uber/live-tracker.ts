import "server-only";

import { getUberHeaders } from "@/lib/uber/client";
import type { LiveOrderStatus, UberSession } from "@/lib/uber/types";

const UBER_ORIGIN = "https://www.ubereats.com";

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

export async function getLiveOrderStatus(
  session: UberSession,
): Promise<LiveOrderStatus | null> {
  const res = await fetch(`${UBER_ORIGIN}/_p/api/getActiveOrderV1`, {
    method: "GET",
    headers: getUberHeaders(session),
  });

  const json = await res.json().catch(() => null);
  if (!res.ok) {
    if (res.status === 404) return null;
    throw new Error(`getActiveOrderV1 failed: ${res.status}`);
  }

  if (!json || typeof json !== "object") return null;

  const root = json as Record<string, unknown>;
  const data = (root.data ?? root.order ?? root.activeOrder ?? root) as Record<
    string,
    unknown
  >;

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
    data.deliveryLocation ??
    data.dropoffLocation ??
    data.eaterLocation;

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
