import Link from "next/link";

export const dynamic = "force-dynamic";
import { RANKINGS_PUBLIC_MIN_RESOLVED_ORDERS } from "@/lib/product/rules";
import { getRankingSummaries } from "@/lib/rankings/summaries";

export default async function RankingsPage() {
  const rows = await getRankingSummaries();
  const sorted = [...rows].sort((a, b) => b.resolvedOrderCount - a.resolvedOrderCount);
  const maxCount = Math.max(1, ...sorted.map((r) => r.resolvedOrderCount));
  const worst = sorted[sorted.length - 1] ?? null;

  return (
    <main className="slice-page">
      <Link href="/" className="slice-logo text-xl">slice</Link>
      <h1 className="slice-heading mt-4 text-3xl">Waterloo delivery rankings</h1>
      <p className="mt-2 text-sm" style={{ color: "var(--slice-muted)" }}>
        Based on {rows.reduce((t, r) => t + r.resolvedOrderCount, 0)} resolved orders
      </p>

      <div className="mt-5 flex gap-2 overflow-x-auto pb-1">
        {["All", "Friday nights", "Late night", "Lunch rush"].map((pill, i) => (
          <button
            key={pill}
            type="button"
            className={`rounded-full px-3 py-1.5 text-xs ${i === 0 ? "slice-btn-primary" : "slice-btn-secondary"}`}
          >
            {pill}
          </button>
        ))}
      </div>

      {worst ? (
        <section className="slice-card mt-5 p-4" style={{ borderColor: "var(--slice-red)" }}>
          <p className="slice-label text-[10px]" style={{ color: "var(--slice-red)" }}>On the spit</p>
          <p className="slice-heading mt-1 text-2xl">{worst.displayName}</p>
          <p className="mt-2 text-sm" style={{ color: "var(--slice-muted)" }}>
            Late rate est. {Math.max(5, 100 - Math.round((worst.resolvedOrderCount / maxCount) * 100))}% · sample {worst.resolvedOrderCount}
          </p>
        </section>
      ) : null}

      <div className="mt-4 space-y-3">
        {sorted.map((row, i) => {
          const pct = Math.round((row.resolvedOrderCount / maxCount) * 100);
          const badness = 100 - pct;
          return (
            <article key={row.restaurantNameNormalized} className="slice-card slice-fade-up p-3" style={{ animationDelay: `${i * 80}ms` }}>
              <div className="mb-2 flex items-center gap-3">
                <p className="w-6 text-sm" style={{ color: "var(--slice-muted)" }}>#{i + 1}</p>
                <p>{row.displayName}</p>
              </div>
              <div className="slice-progress">
                <div
                  className="h-full rounded-[99px]"
                  style={{
                    width: `${pct}%`,
                    background: badness > 50 ? "var(--slice-red)" : "var(--slice-green)",
                  }}
                />
              </div>
              <p className="mt-2 text-xs" style={{ color: "var(--slice-muted)" }}>
                {badness}% late est. · {row.resolvedOrderCount} orders
                {row.resolvedOrderCount < RANKINGS_PUBLIC_MIN_RESOLVED_ORDERS ? " · low sample" : ""}
              </p>
            </article>
          );
        })}
      </div>
    </main>
  );
}
