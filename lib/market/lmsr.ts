export type MarketState = {
  b: number;
  q_over: number;
  q_under: number;
};
export type LMSRState = MarketState;

function clamp(n: number, lo: number, hi: number) {
  if (!Number.isFinite(n)) return lo;
  return Math.min(hi, Math.max(lo, n));
}

function cost(s: MarketState): number {
  const b = Math.max(1e-6, s.b);
  return b * Math.log(Math.exp(s.q_over / b) + Math.exp(s.q_under / b));
}

export function priceOver(s: MarketState): number {
  const b = Math.max(1e-6, s.b);
  const a = Math.exp(s.q_over / b);
  const u = Math.exp(s.q_under / b);
  return clamp(a / (a + u), 0.03, 0.97);
}
export const getOverPrice = priceOver;

export function initMarket(params: { prior: number; liquidity?: number }): MarketState {
  const prior = clamp(params.prior, 0.03, 0.97);
  const b = Math.max(10, Math.floor(params.liquidity ?? 80));
  // Initialize q's so initial price ~= prior.
  // For LMSR with two outcomes: p = exp(q_over/b) / (exp(q_over/b)+exp(q_under/b))
  // Set q_under=0, solve q_over = b*ln(p/(1-p)).
  const q_under = 0;
  const q_over = b * Math.log(prior / (1 - prior));
  return { b, q_over, q_under };
}

export function placeBet(
  s: MarketState,
  side: "over" | "under",
  amount: number,
): { next: MarketState; newPriceOver: number; costDelta: number } {
  const amt = Math.max(1, Math.floor(amount));
  const before = cost(s);
  const next: MarketState =
    side === "over"
      ? { ...s, q_over: s.q_over + amt }
      : { ...s, q_under: s.q_under + amt };
  const after = cost(next);
  return { next, newPriceOver: priceOver(next), costDelta: after - before };
}

export function getBlendedProbability(params: {
  modelPrior: number;
  lmsrState: MarketState;
  bayesianUpdate: number | null;
  minutesElapsed: number;
  etaMinutes: number;
  betCount: number;
}): {
  probability: number;
  weights: { model: number; crowd: number; reality: number };
  dominant: "model" | "crowd" | "reality";
} {
  const { modelPrior, lmsrState, bayesianUpdate, minutesElapsed, etaMinutes, betCount } = params;
  const lmsrPrice = priceOver(lmsrState);
  const timeProgress = etaMinutes > 0 ? minutesElapsed / etaMinutes : 0;

  let wModel: number;
  let wCrowd: number;
  let wReality: number;

  if (bayesianUpdate !== null && timeProgress > 0.8) {
    wModel = 0.1;
    wCrowd = 0.15;
    wReality = 0.75;
  } else if (betCount >= 5) {
    wModel = 0.35;
    wCrowd = 0.55;
    wReality = 0.1;
  } else if (betCount >= 2) {
    wModel = 0.55;
    wCrowd = 0.35;
    wReality = 0.1;
  } else {
    wModel = 0.8;
    wCrowd = 0.15;
    wReality = 0.05;
  }

  const reality = bayesianUpdate ?? modelPrior;
  const probability = clamp(wModel * modelPrior + wCrowd * lmsrPrice + wReality * reality, 0.03, 0.97);
  const dominant: "model" | "crowd" | "reality" =
    wReality > 0.5 ? "reality" : wCrowd > wModel ? "crowd" : "model";

  return {
    probability,
    weights: { model: wModel, crowd: wCrowd, reality: wReality },
    dominant,
  };
}

