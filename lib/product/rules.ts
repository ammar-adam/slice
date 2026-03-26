/**
 * Locked week-1 product rules (do not diverge without explicit product change).
 */

/** Bet resolves against placement-time ETA only (minutes from confirmation). */
export const MARKET_USES_ETA_INITIAL_ONLY = true;

/** If no delivered email by this deadline, bet is void (no points). */
export const VOID_GRACE_AFTER_ETA_MINUTES = 180;

/** Rankings: show full stats only when a restaurant has this many resolved orders. */
export const RANKINGS_PUBLIC_MIN_RESOLVED_ORDERS = 5;

/** Cron: Gmail poll interval (minutes) for Edge — document only; configure in Supabase. */
export const GMAIL_POLL_INTERVAL_MINUTES = 5;

export function computeBetResolveDeadline(args: {
  orderPlacedAt: Date;
  etaInitialMinutes: number;
}): Date {
  const promised = new Date(
    args.orderPlacedAt.getTime() + args.etaInitialMinutes * 60_000
  );
  return new Date(promised.getTime() + VOID_GRACE_AFTER_ETA_MINUTES * 60_000);
}

/**
 * Late vs market line: actual minutes from placement to delivery, vs initial ETA minutes.
 * eta_final is ignored for the line (stored for analytics only).
 */
export function isLateVsInitialEta(args: {
  actualDeliveryMinutes: number;
  etaInitialMinutes: number;
}): boolean {
  return args.actualDeliveryMinutes > args.etaInitialMinutes;
}
