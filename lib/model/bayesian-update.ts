function clamp(n: number, lo: number, hi: number): number {
  if (!Number.isFinite(n)) return lo;
  return Math.min(hi, Math.max(lo, n));
}

/**
 * Update the probability that an order will end up "late" (actual > eta_initial).
 * Pure function: no side effects, deterministic.
 */
export function updateDelayProbability(params: {
  prior: number;
  eta_initial: number;
  eta_final: number | null;
  minutes_elapsed: number;
  delivered: boolean;
}): number {
  const prior = clamp(params.prior, 0.03, 0.97);
  const etaInitial = Math.max(1, Math.floor(params.eta_initial));
  const minutesElapsed = Math.max(0, params.minutes_elapsed);

  // If delivered: there is no longer any future "risk" signal to show.
  if (params.delivered) return 0.03;

  // Driver phase — updated ETA available.
  if (typeof params.eta_final === "number" && Number.isFinite(params.eta_final)) {
    const etaFinal = Math.max(1, Math.floor(params.eta_final));
    const pickupDelay = 8; // heuristic: typical time between placed and "on the way"
    const timeRemaining = etaFinal - (minutesElapsed - pickupDelay);

    if (timeRemaining <= 0) {
      return clamp(prior * 1.8, 0.03, 0.97);
    }

    const urgency = clamp(1 - timeRemaining / etaFinal, 0, 1);
    return clamp(prior + urgency * 0.3, 0.03, 0.97);
  }

  // Prep phase — probability rises slowly as we approach the initial ETA window.
  const prepFactor = minutesElapsed / etaInitial;
  if (prepFactor < 0.4) return prior;
  if (prepFactor > 0.8) return clamp(prior * 1.3, prior, 0.92);
  return prior;
}

