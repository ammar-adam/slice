import Link from "next/link";

import { RankingList } from "@/components/marketing/ranking-list";

export const dynamic = "force-dynamic";
import { RANKINGS_PUBLIC_MIN_RESOLVED_ORDERS } from "@/lib/product/rules";
import { getRankingSummaries } from "@/lib/rankings/summaries";

export default async function RankingsPage() {
  const rows = await getRankingSummaries();

  return (
    <main className="mx-auto max-w-md px-5 py-10">
      <Link
        href="/"
        className="text-xs font-semibold uppercase tracking-wide text-slice-primary"
      >
        ← Slice
      </Link>
      <h1 className="mt-4 text-2xl font-bold text-neutral-900">
        Waterloo delivery rankings
      </h1>
      <p className="mt-2 text-sm text-neutral-600">
        Built from real resolved orders — restaurant names only. Full detail unlocks
        after {RANKINGS_PUBLIC_MIN_RESOLVED_ORDERS}+ on-time data points per spot.
      </p>
      <div className="mt-6">
        <RankingList rows={rows} />
      </div>
    </main>
  );
}
