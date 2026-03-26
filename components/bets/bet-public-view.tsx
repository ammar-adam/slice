"use client";

import type { RealtimePostgresChangesPayload } from "@supabase/supabase-js";
import { useEffect, useMemo, useState } from "react";

import type { PublicBetPayload } from "@/lib/bets/public-bet-types";
import { createBrowserSupabase } from "@/lib/supabase/browser";
import type { BetSide } from "@/types/domain";

type Participant = PublicBetPayload["participants"][number];

function useEtaCountdown(orderPlacedAt: string, etaMinutes: number | null) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  if (etaMinutes == null) {
    return { primary: "—", secondary: "ETA not set", past: false };
  }

  const target = new Date(orderPlacedAt).getTime() + etaMinutes * 60_000;
  const delta = target - now;
  if (delta <= 0) {
    const lateSec = Math.floor(-delta / 1000);
    const m = Math.floor(lateSec / 60);
    const s = lateSec % 60;
    return {
      primary: `${m}:${s.toString().padStart(2, "0")}`,
      secondary: "Past quoted ETA",
      past: true,
    };
  }

  const totalSec = Math.floor(delta / 1000);
  const cm = Math.floor(totalSec / 60);
  const cs = totalSec % 60;
  return {
    primary: `${cm}:${cs.toString().padStart(2, "0")}`,
    secondary: "Until quoted ETA",
    past: false,
  };
}

function participantFromRow(row: Record<string, unknown>): Participant | null {
  if (typeof row.id !== "string" || typeof row.display_name !== "string") return null;
  const side = row.side;
  if (side !== "over" && side !== "under") return null;
  return {
    id: row.id,
    display_name: row.display_name,
    side,
    is_correct: row.is_correct === null || row.is_correct === undefined ? null : Boolean(row.is_correct),
    points_delta: typeof row.points_delta === "number" ? row.points_delta : null,
    created_at: typeof row.created_at === "string" ? row.created_at : new Date().toISOString(),
  };
}

function sortParticipants(list: Participant[]) {
  return [...list].sort(
    (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
  );
}

export function BetPublicView(props: { slug: string; initial: PublicBetPayload }) {
  const supabase = useMemo(() => createBrowserSupabase(), []);
  const [participants, setParticipants] = useState<Participant[]>(() =>
    sortParticipants(props.initial.participants)
  );

  const { bet, order } = props.initial;
  const countdown = useEtaCountdown(order.order_placed_at, order.eta_initial_minutes);
  const probPct = Math.round(Number(bet.delay_probability) * 100);

  const [displayName, setDisplayName] = useState("");
  const [side, setSide] = useState<BetSide>("over");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isOpen = bet.status === "open";

  useEffect(() => {
    setParticipants(sortParticipants(props.initial.participants));
  }, [props.initial.participants]);

  useEffect(() => {
    if (!isOpen) return;

    const channel = supabase
      .channel(`bet-participants:${bet.id}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "bet_participants",
          filter: `bet_id=eq.${bet.id}`,
        },
        (payload: RealtimePostgresChangesPayload<{ [key: string]: unknown }>) => {
          const row = payload.new;
          if (!row || typeof row !== "object") return;
          const p = participantFromRow(row as Record<string, unknown>);
          if (!p) return;
          setParticipants((prev) => {
            if (prev.some((x) => x.id === p.id)) return prev;
            return sortParticipants([...prev, p]);
          });
        }
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [supabase, bet.id, isOpen]);

  async function submitPick(e: React.FormEvent) {
    e.preventDefault();
    if (!isOpen) return;
    setError(null);
    setBusy(true);
    try {
      const res = await fetch("/api/internal/bets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          slug: props.slug,
          displayName,
          side,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setError(typeof data.error === "string" ? data.error : "Could not place pick");
        return;
      }
      setDisplayName("");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-5">
      <div className="overflow-hidden rounded-3xl bg-white shadow-sm ring-1 ring-black/[0.06]">
        <div className="bg-gradient-to-br from-slice-primary to-orange-600 px-5 py-6 text-white">
          <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-white/80">
            Delivery bet
          </p>
          <h1 className="mt-2 text-2xl font-bold leading-tight">{order.restaurant_name}</h1>
          <div className="mt-5 flex items-end justify-between gap-4">
            <div>
              <p className="text-3xl font-black tabular-nums tracking-tight">
                {countdown.primary}
              </p>
              <p
                className={`text-xs font-medium ${countdown.past ? "text-amber-100" : "text-white/80"}`}
              >
                {countdown.secondary}
              </p>
            </div>
            <div className="rounded-2xl bg-white/15 px-3 py-2 text-right ring-1 ring-white/20 backdrop-blur-sm">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-white/70">
                Model (late)
              </p>
              <p className="text-xl font-bold tabular-nums">{probPct}%</p>
            </div>
          </div>
        </div>

        <div className="space-y-4 px-5 py-5">
          {bet.dare_text ? (
            <div className="rounded-2xl bg-orange-50/90 px-4 py-3 ring-1 ring-orange-100">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-slice-primary">
                Dare
              </p>
              <p className="mt-1 text-sm font-medium text-neutral-900">{bet.dare_text}</p>
            </div>
          ) : null}

          {!isOpen ? (
            <p className="rounded-2xl bg-neutral-100 px-4 py-3 text-center text-sm text-neutral-600">
              This bet is {bet.status === "resolved" ? "resolved" : "closed"} — new picks are off.
            </p>
          ) : null}

          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-neutral-500">
              In so far
            </p>
            {participants.length === 0 ? (
              <p className="mt-3 rounded-2xl bg-neutral-50 px-4 py-6 text-center text-sm text-neutral-500 ring-1 ring-black/[0.04]">
                No picks yet. Be the first.
              </p>
            ) : (
              <ul className="mt-2 divide-y divide-neutral-100 rounded-2xl ring-1 ring-black/[0.04]">
                {participants.map((p) => (
                  <li key={p.id} className="flex items-center justify-between gap-3 px-4 py-3">
                    <span className="font-medium text-neutral-900">{p.display_name}</span>
                    <span
                      className={`rounded-full px-3 py-1 text-xs font-semibold ${
                        p.side === "over"
                          ? "bg-orange-100 text-orange-900"
                          : "bg-emerald-100 text-emerald-900"
                      }`}
                    >
                      {p.side === "over" ? "Over (late)" : "Under (on time)"}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>

      <form
        onSubmit={submitPick}
        className={`rounded-3xl bg-white p-5 shadow-sm ring-1 ring-black/[0.06] ${!isOpen ? "opacity-50" : ""}`}
      >
        <p className="text-xs font-semibold uppercase tracking-wide text-slice-primary">
          Your pick
        </p>
        <p className="mt-1 text-sm text-neutral-600">
          Over = later than the quoted ETA. Under = on time or early.
        </p>

        <label className="mt-4 block space-y-2">
          <span className="text-xs font-medium text-neutral-600">Name</span>
          <input
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            placeholder="What should we call you?"
            autoComplete="nickname"
            disabled={!isOpen}
            required
            className="w-full rounded-2xl border border-neutral-200 bg-neutral-50 px-4 py-3.5 text-base outline-none ring-slice-primary/25 focus:border-slice-primary focus:bg-white focus:ring-2 disabled:opacity-60"
          />
        </label>

        <div className="mt-4 grid grid-cols-2 gap-3">
          <button
            type="button"
            disabled={!isOpen}
            onClick={() => setSide("over")}
            className={`rounded-2xl border-2 py-3.5 text-sm font-semibold transition ${
              side === "over"
                ? "border-slice-primary bg-orange-50 text-orange-950"
                : "border-neutral-200 bg-white text-neutral-700 hover:border-neutral-300"
            } disabled:opacity-50`}
          >
            Over
          </button>
          <button
            type="button"
            disabled={!isOpen}
            onClick={() => setSide("under")}
            className={`rounded-2xl border-2 py-3.5 text-sm font-semibold transition ${
              side === "under"
                ? "border-emerald-600 bg-emerald-50 text-emerald-950"
                : "border-neutral-200 bg-white text-neutral-700 hover:border-neutral-300"
            } disabled:opacity-50`}
          >
            Under
          </button>
        </div>

        {error ? (
          <p className="mt-3 rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
        ) : null}

        <button
          type="submit"
          disabled={busy || !isOpen}
          className="mt-5 w-full rounded-2xl bg-slice-primary py-4 text-base font-semibold text-white shadow-md shadow-orange-200/40 transition hover:brightness-105 disabled:opacity-50"
        >
          {busy ? "Placing…" : "Place pick"}
        </button>
      </form>
    </div>
  );
}
