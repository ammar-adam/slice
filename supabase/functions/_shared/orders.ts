/** Align with product: normalized restaurant key for matching + dedupe. */
export function normalizeRestaurantKey(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .replace(/[^a-z0-9'&]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export type UnresolvedOrderRow = {
  id: string;
  host_id: string;
  restaurant_name_normalized: string;
  eta_initial_minutes: number | null;
  order_placed_at: string;
  resolved: boolean;
  actual_delivery_minutes: number | null;
  gmail_message_id_placed: string | null;
  gmail_message_id_enroute: string | null;
  gmail_message_id_delivered: string | null;
};

export type DeliveryCandidate = {
  messageId: string;
  receivedAt: Date;
  restaurantNorm: string;
};

/** Latest order placed strictly before email time, same restaurant + host, within window. */
export function pickOrderForDelivery(
  orders: UnresolvedOrderRow[],
  d: DeliveryCandidate,
  alreadyMatched: Set<string>,
  maxOrderAgeMs: number,
  predicate?: (o: UnresolvedOrderRow) => boolean,
): UnresolvedOrderRow | null {
  const emailTs = d.receivedAt.getTime();
  const lower = emailTs - maxOrderAgeMs;
  const candidates = orders.filter((o) => {
    if (alreadyMatched.has(o.id)) return false;
    if (predicate && !predicate(o)) return false;
    if (o.resolved) return false;
    if (o.restaurant_name_normalized !== d.restaurantNorm) return false;
    const placed = Date.parse(o.order_placed_at);
    if (!Number.isFinite(placed) || placed >= emailTs) return false;
    if (placed < lower) return false;
    return true;
  });
  if (candidates.length === 0) return null;
  return candidates.reduce((best, o) => {
    const bt = Date.parse(best.order_placed_at);
    const ot = Date.parse(o.order_placed_at);
    return ot > bt ? o : best;
  });
}

export function actualMinutesBetween(
  orderPlacedAtIso: string,
  deliveredAt: Date,
): number | null {
  const placed = Date.parse(orderPlacedAtIso);
  const ms = deliveredAt.getTime() - placed;
  if (!Number.isFinite(ms) || ms < 0) return null;
  const mins = Math.round(ms / 60_000);
  if (mins > 24 * 60) return null;
  return Math.max(0, mins);
}
