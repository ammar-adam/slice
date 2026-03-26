import { cn } from "@/lib/utils";
import type { RankingSummaryRow } from "@/lib/rankings/summaries";

export function RankingList(props: { rows: RankingSummaryRow[] }) {
  if (props.rows.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-neutral-200 bg-white p-8 text-center text-sm text-neutral-500">
        No public rollup yet — check back after the first resolves roll in.
      </div>
    );
  }

  return (
    <ul className="space-3">
      {props.rows.map((row) => (
        <li
          key={row.restaurantNameNormalized}
          className={cn(
            "rounded-2xl px-4 py-3 shadow-sm ring-1 ring-black/5",
            row.isPublic ? "bg-white" : "bg-neutral-100"
          )}
        >
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-sm font-semibold text-neutral-900">
                {row.displayName}
              </p>
              <p className="text-xs text-neutral-500">
                {row.resolvedOrderCount} resolved orders in dataset
              </p>
            </div>
            {!row.isPublic ? (
              <span className="shrink-0 rounded-full bg-white px-2 py-1 text-[10px] font-bold uppercase tracking-wide text-neutral-500 ring-1 ring-neutral-200">
                Locked
              </span>
            ) : (
              <span className="shrink-0 rounded-full bg-emerald-50 px-2 py-1 text-[10px] font-bold uppercase tracking-wide text-emerald-700 ring-1 ring-emerald-100">
                Live
              </span>
            )}
          </div>
        </li>
      ))}
    </ul>
  );
}
