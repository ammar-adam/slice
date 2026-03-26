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
      <div className="slice-card overflow-hidden">
        <div className="px-5 py-5">
          <p className="slice-label text-[10px]" style={{ color: "var(--slice-muted)" }}>
            Delivery bet
          </p>
          <h1 className="slice-heading mt-2 text-2xl leading-tight">{order.restaurant_name}</h1>
          <div className="mt-5 flex items-end justify-between gap-4">
            <div>
              <p className="slice-number text-3xl tabular-nums">
                {countdown.primary}
              </p>
              <p className="text-xs" style={{ color: countdown.past ? "var(--slice-red)" : "var(--slice-muted)" }}>
                {countdown.secondary}
              </p>
            </div>
            <div className="slice-card px-3 py-2 text-right">
              <p className="slice-label text-[10px]" style={{ color: "var(--slice-muted)" }}>
                Model (late)
              </p>
              <p className="slice-number text-xl tabular-nums">{probPct}%</p>
            </div>
          </div>
        </div>

        <div className="space-y-4 px-5 py-5">
          {bet.dare_text ? (
            <div className="slice-card slice-active px-4 py-3">
              <p className="slice-label text-[10px]" style={{ color: "var(--slice-orange)" }}>
                Dare
              </p>
              <p className="mt-1 text-sm">{bet.dare_text}</p>
            </div>
          ) : null}

          {!isOpen ? (
            <p className="slice-card px-4 py-3 text-center text-sm" style={{ color: "var(--slice-muted)" }}>
              This bet is {bet.status === "resolved" ? "resolved" : "closed"} — new picks are off.
            </p>
          ) : null}

          <div>
            <p className="slice-label text-[10px]" style={{ color: "var(--slice-muted)" }}>
              In so far
            </p>
            {participants.length === 0 ? (
              <p className="slice-card mt-3 px-4 py-6 text-center text-sm" style={{ color: "var(--slice-muted)" }}>
                No picks yet. Be the first.
              </p>
            ) : (
              <ul className="slice-card mt-2 divide-y" style={{ borderColor: "var(--slice-border)" }}>
                {participants.map((p) => (
                  <li key={p.id} className="flex items-center justify-between gap-3 px-4 py-3">
                    <span>{p.display_name}</span>
                    <span
                      className="rounded-full px-3 py-1 text-xs"
                      style={{
                        border: "1px solid var(--slice-border2)",
                        color: p.side === "over" ? "var(--slice-orange)" : "var(--slice-green)",
                      }}
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
        className={`slice-card p-5 ${!isOpen ? "opacity-50" : ""}`}
      >
        <p className="slice-label text-[10px]" style={{ color: "var(--slice-muted)" }}>
          Your pick
        </p>
        <p className="mt-1 text-sm" style={{ color: "var(--slice-muted)" }}>
          Over = later than the quoted ETA. Under = on time or early.
        </p>

        <label className="mt-4 block space-y-2">
          <span className="slice-label text-[10px]" style={{ color: "var(--slice-muted)" }}>Name</span>
          <input
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            placeholder="What should we call you?"
            autoComplete="nickname"
            disabled={!isOpen}
            required
            className="slice-input w-full px-4 py-3.5 text-base disabled:opacity-60"
          />
        </label>

        <div className="mt-4 grid grid-cols-2 gap-3">
          <button
            type="button"
            disabled={!isOpen}
            onClick={() => setSide("over")}
            className={`slice-card py-3.5 text-sm transition disabled:opacity-50 ${side === "over" ? "slice-active" : ""}`}
          >
            Over
          </button>
          <button
            type="button"
            disabled={!isOpen}
            onClick={() => setSide("under")}
            className={`slice-card py-3.5 text-sm transition disabled:opacity-50 ${side === "under" ? "slice-active" : ""}`}
          >
            Under
          </button>
        </div>

        {error ? (
          <p className="mt-3 text-sm" style={{ color: "var(--slice-red)" }}>{error}</p>
        ) : null}

        <button
          type="submit"
          disabled={busy || !isOpen}
          className="slice-btn-primary mt-5 w-full py-4 text-base disabled:opacity-50"
        >
          {busy ? "Placing..." : `Bet ${side === "over" ? "Over" : "Under"} · ${side === "over" ? Math.max(1, Math.round(probPct * 0.73)) : Math.max(1, 100 - Math.round(probPct * 0.73))}¢`}
        </button>
      </form>
    </div>
  );
}
