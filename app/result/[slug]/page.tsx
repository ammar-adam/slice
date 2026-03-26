import Link from "next/link";

import { getPublicBetBySlug } from "@/lib/bets/public-bet";
import { isPublicBetPayload } from "@/lib/bets/public-bet-types";

type Participant = {
  id: string;
  display_name: string;
  side: "over" | "under";
  is_correct: boolean | null;
  points_delta: number | null;
};

export const dynamic = "force-dynamic";

export default async function ResultPage(props: { params: { slug: string } }) {
  const slug = props.params.slug;
  const payload = await getPublicBetBySlug(slug);

  if (!payload || !isPublicBetPayload(payload)) {
    return (
      <main className="slice-page">
        <Link href="/" className="slice-logo text-lg">
          slice
        </Link>
        <div className="slice-card mt-6 p-8 text-center">
          <p className="text-sm">Result not found.</p>
          <p className="mt-2 text-xs" style={{ color: "var(--slice-muted)" }}>{slug}</p>
        </div>
      </main>
    );
  }

  const bet = payload.bet;
  const order = payload.order;
  const participants = (payload.participants ?? []) as Participant[];

  const eta = order.eta_initial_minutes ?? null;
  const actual = order.actual_delivery_minutes ?? null;
  const predictedPct = Math.round(Number(bet.delay_probability) * 100);

  const delivered = bet.status === "resolved" && actual != null && eta != null;
  const lateBy = delivered ? Math.max(0, actual - eta) : null;
  const onTime = delivered ? actual <= eta : null;

  const winners = participants.filter((p) => p.is_correct === true);
  const losers = participants.filter((p) => p.is_correct === false);
  const timingLabel =
    bet.status === "void"
      ? "voided"
      : !delivered
        ? "resolving"
        : onTime
          ? `${Math.max(0, (eta ?? 0) - (actual ?? 0))} min early`
          : `${lateBy ?? 0} min late`;

  return (
    <main className="slice-page">
      <div className="slice-card slice-hero-card slice-fade-up overflow-hidden p-6" style={{ animationDelay: "0ms" }}>
        <p className="slice-label text-[10px]" style={{ color: "var(--slice-muted)" }}>Result</p>
        <p className="slice-number mt-2 text-5xl" style={{ color: onTime ? "var(--slice-green)" : "var(--slice-red)" }}>
          {actual != null ? `${actual} min` : "--"}
        </p>
        <p className="mt-2 text-sm" style={{ color: "var(--slice-muted)" }}>
          {timingLabel}
        </p>
        <p className="mt-3 text-xs" style={{ color: "var(--slice-muted)" }}>
          Model predicted {predictedPct}% late
        </p>
      </div>

      <div className="slice-card slice-fade-up mt-4 p-5" style={{ animationDelay: "80ms" }}>
        <p className="slice-label text-[10px]" style={{ color: "var(--slice-muted)" }}>
          Order
        </p>
        <p className="slice-heading mt-1 text-2xl">{order.restaurant_name}</p>
        {bet.dare_text ? (
          <div className="slice-card mt-4 w-full px-4 py-3" style={{ borderColor: "var(--slice-orange-mid)" }}>
            <p className="slice-label text-[10px]" style={{ color: "var(--slice-orange)" }}>
              Dare
            </p>
            <p className="mt-1 text-sm">{bet.dare_text}</p>
          </div>
        ) : null}
      </div>

      <div className="slice-fade-up mt-4 grid grid-cols-2 gap-3" style={{ animationDelay: "160ms" }}>
        <div className="slice-card p-5">
          <p className="slice-label text-[10px]" style={{ color: "var(--slice-green)" }}>
            Winners
          </p>
          {winners.length === 0 ? (
            <p className="mt-4 text-sm" style={{ color: "var(--slice-muted)" }}>—</p>
          ) : (
            <ul className="mt-3 space-y-2">
              {winners.map((p) => (
                <li key={p.id} className="flex items-center justify-between">
                  <span className="text-lg" style={{ fontFamily: "var(--font-slice-display)", fontWeight: 700 }}>{p.display_name}</span>
                  <span className="text-sm" style={{ color: "var(--slice-green)" }}>
                    +{p.points_delta ?? 0}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="slice-card p-5">
          <p className="slice-label text-[10px]" style={{ color: "var(--slice-red)" }}>
            Losers
          </p>
          {losers.length === 0 ? (
            <p className="mt-4 text-sm" style={{ color: "var(--slice-muted)" }}>—</p>
          ) : (
            <ul className="mt-3 space-y-2">
              {losers.map((p) => (
                <li key={p.id} className="flex items-center justify-between">
                  <span style={{ color: "var(--slice-muted)" }}>{p.display_name}</span>
                  <span className="text-sm" style={{ color: "var(--slice-muted)" }}>
                    {p.points_delta ?? -20}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <div className="slice-fade-up mt-4 grid grid-cols-3 gap-3" style={{ animationDelay: "240ms" }}>
        <div className="slice-card p-3"><p className="slice-label text-[10px]" style={{ color: "var(--slice-muted)" }}>Accuracy</p><p className="slice-number mt-1 text-2xl">{predictedPct}%</p></div>
        <div className="slice-card p-3"><p className="slice-label text-[10px]" style={{ color: "var(--slice-muted)" }}>Streak</p><p className="slice-number mt-1 text-2xl">{Math.max(1, winners.length)}</p></div>
        <div className="slice-card p-3"><p className="slice-label text-[10px]" style={{ color: "var(--slice-muted)" }}>Points</p><p className="slice-number mt-1 text-2xl">{participants.reduce((t, p) => t + (p.points_delta ?? 0), 0)}</p></div>
      </div>

      <div className="slice-card mt-4 p-4">
        <p className="slice-label text-[10px]" style={{ color: "var(--slice-muted)" }}>Model vs actual</p>
        <div className="mt-3 space-y-3">
          <div>
            <div className="mb-1 flex justify-between text-xs"><span>Model late</span><span>{predictedPct}%</span></div>
            <div className="slice-progress"><div className="slice-progress-fill" style={{ width: `${predictedPct}%` }} /></div>
          </div>
          <div>
            <div className="mb-1 flex justify-between text-xs"><span>Actual late</span><span>{onTime ? 0 : 100}%</span></div>
            <div className="slice-progress"><div className="slice-progress-fill" style={{ width: `${onTime ? 0 : 100}%` }} /></div>
          </div>
        </div>
      </div>

      <div className="mt-5">
        <div className="grid grid-cols-2 gap-3">
          <Link
            href="/create"
            className="slice-btn-primary py-3 text-center text-sm"
          >
            Share result
          </Link>
          <Link href="/create" className="slice-btn-secondary py-3 text-center text-sm">Make a bet</Link>
        </div>
        <p className="mt-6 text-center text-xs" style={{ color: "var(--slice-muted)" }}>
          slice.app · bet/{slug}
        </p>
      </div>
    </main>
  );
}

