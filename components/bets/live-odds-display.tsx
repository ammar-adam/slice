"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import { updateDelayProbability } from "@/lib/model/bayesian-update";
import { getBlendedProbability, getOverPrice, initMarket, type LMSRState } from "@/lib/market/lmsr";
import { createBrowserSupabase } from "@/lib/supabase/browser";

function clamp(n: number, lo: number, hi: number) {
  return Math.min(hi, Math.max(lo, n));
}

function minutesBetween(a: Date, b: Date): number {
  const ms = b.getTime() - a.getTime();
  if (!Number.isFinite(ms)) return 0;
  return Math.max(0, Math.floor(ms / 60_000));
}

function fmtMinutes(n: number) {
  const m = Math.max(0, Math.round(n));
  return `${m} min`;
}

export function LiveOddsDisplay(props: {
  betId: string;
  participantCount: number;
  initialProbability: number;
  initialLmsrState: LMSRState | null;
  etaInitialMinutes: number;
  etaFinalMinutes: number | null;
  orderPlacedAt: Date;
  orderId: string;
  resolved: boolean;
}) {
  const supabase = useMemo(() => createBrowserSupabase(), []);
  const [etaFinal, setEtaFinal] = useState<number | null>(props.etaFinalMinutes);
  const [delivered, setDelivered] = useState<boolean>(props.resolved);
  const [lmsrState, setLmsrState] = useState<LMSRState | null>(props.initialLmsrState);
  const [dominant, setDominant] = useState<"model" | "crowd" | "reality">("model");
  const [prob, setProb] = useState(() =>
    clamp(Number(props.initialProbability) || 0.5, 0.03, 0.97),
  );

  const [now, setNow] = useState(() => new Date());
  const lastCalcRef = useRef<number>(0);

  const etaInitial = Math.max(1, Math.floor(props.etaInitialMinutes));
  const elapsedMin = minutesBetween(props.orderPlacedAt, now);

  const phase = (() => {
    if (delivered) return "delivered" as const;
    if (etaFinal != null) return "driver" as const;
    const prep = elapsedMin / etaInitial;
    if (prep < 0.4) return "prep" as const;
    if (elapsedMin >= etaInitial) return "late" as const;
    return "prep" as const;
  })();

  const remainingMin =
    etaFinal != null ? Math.max(0, etaFinal - elapsedMin) : Math.max(0, etaInitial - elapsedMin);

  const label = (() => {
    switch (phase) {
      case "delivered":
        return "Delivered · resolving bets";
      case "driver":
        return `Driver on the way · ${fmtMinutes(remainingMin)} remaining`;
      case "late":
        return "Running late · odds rising";
      case "prep":
      default:
        return "Being prepared · odds updating live";
    }
  })();

  const color = (() => {
    if (prob > 0.6) return "from-orange-600 to-red-600";
    if (prob < 0.4) return "from-emerald-600 to-emerald-500";
    return "from-amber-500 to-orange-500";
  })();

  const progress = (() => {
    const denom = etaFinal ?? etaInitial;
    if (!Number.isFinite(denom) || denom <= 0) return 0;
    return clamp(elapsedMin / denom, 0, 1);
  })();

  function recalc(nowTs = Date.now()) {
    const mins = minutesBetween(props.orderPlacedAt, new Date(nowTs));
    const bayesian = updateDelayProbability({
      prior: props.initialProbability,
      eta_initial: etaInitial,
      eta_final: etaFinal,
      minutes_elapsed: mins,
      delivered,
    });
    const effectiveLmsr = lmsrState ?? initMarket({ prior: props.initialProbability, liquidity: 80 });
    const blended = getBlendedProbability({
      modelPrior: props.initialProbability,
      lmsrState: effectiveLmsr,
      bayesianUpdate: bayesian,
      minutesElapsed: mins,
      etaMinutes: etaInitial,
      betCount: props.participantCount,
    });
    const crowdPrice = getOverPrice(effectiveLmsr);
    void crowdPrice;
    setProb(blended.probability);
    setDominant(blended.dominant);
    lastCalcRef.current = nowTs;
  }

  useEffect(() => {
    // Tick clock every second for progress bar/labels.
    const id = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    // Recalculate odds every 30 seconds (and immediately).
    recalc(Date.now());
    const id = window.setInterval(() => recalc(Date.now()), 30_000);
    return () => window.clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [etaFinal, delivered, etaInitial, props.initialProbability, lmsrState, props.participantCount]);

  useEffect(() => {
    const betChannel = supabase
      .channel(`bet:${props.betId}`)
      .on("broadcast", { event: "lmsr_update" }, (payload) => {
        const state = (payload?.payload as { lmsr_state?: unknown })?.lmsr_state;
        if (state && typeof state === "object") {
          setLmsrState(state as LMSRState);
          recalc(Date.now());
        }
      })
      .subscribe();

    const orderChannel = supabase
      .channel(`order:${props.orderId}`)
      .on("broadcast", { event: "eta_update" }, (payload) => {
        const eta = (payload?.payload as { eta_final_minutes?: unknown })?.eta_final_minutes;
        if (typeof eta === "number" && Number.isFinite(eta) && eta > 0) {
          setEtaFinal(Math.round(eta));
        }
        recalc(Date.now());
      })
      .on("broadcast", { event: "delivered" }, (payload) => {
        const actual = (payload?.payload as { actual_minutes?: unknown })?.actual_minutes;
        void actual;
        setDelivered(true);
        recalc(Date.now());
      })
      .subscribe();

    return () => {
      void supabase.removeChannel(betChannel);
      void supabase.removeChannel(orderChannel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supabase, props.orderId, props.betId]);

  const pct = Math.round(prob * 100);

  return (
    <div className="slice-card slice-hero-card p-5">
      <div className="flex items-end justify-between gap-4">
        <div className="min-w-0">
          <p className="slice-label text-[10px]" style={{ color: "var(--slice-muted)" }}>
            Odds (late)
          </p>
          <p
            className="slice-number mt-1 text-6xl tabular-nums"
            style={{ transition: "all 350ms ease" }}
          >
            {pct}%
          </p>
          <p className="mt-1 text-xs" style={{ color: "var(--slice-muted)" }}>{label}</p>
          <p className="mt-1 text-[11px] font-semibold" style={{ color: "var(--slice-muted)" }}>
            {dominant === "model"
              ? "Model prediction"
              : dominant === "crowd"
                ? "Crowd-adjusted"
                : "Live signal"}
          </p>
        </div>
        <div className="slice-card shrink-0 px-3 py-2 text-right">
          <p className="slice-label text-[10px]" style={{ color: "var(--slice-muted)" }}>
            Elapsed
          </p>
          <p className="slice-number text-sm tabular-nums">
            {fmtMinutes(elapsedMin)}
          </p>
        </div>
      </div>

      <div className="mt-4">
        <div className="slice-progress">
          <div
            className={`h-full bg-gradient-to-r ${color}`}
            style={{
              width: `${Math.round(progress * 100)}%`,
              transition: "width 800ms ease",
            }}
          />
        </div>
      </div>
    </div>
  );
}

