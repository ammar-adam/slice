"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";

function minutesBetween(a: Date, b: Date): number {
  const ms = b.getTime() - a.getTime();
  if (!Number.isFinite(ms)) return 0;
  return Math.max(0, Math.round(ms / 60_000));
}

type VoidReason = "cancelled" | "wrong_order" | "never_arrived";

export function HostControls(props: {
  orderId: string;
  betSlug: string;
  orderPlacedAt: Date;
}) {
  const router = useRouter();
  const [open, setOpen] = useState<"arrived" | "void" | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const suggestedMinutes = useMemo(
    () => minutesBetween(props.orderPlacedAt, new Date()),
    [props.orderPlacedAt],
  );
  const [actualMinutes, setActualMinutes] = useState<number>(suggestedMinutes);

  async function submitArrived() {
    setError(null);
    setBusy(true);
    try {
      const res = await fetch(`/api/internal/orders/${props.orderId}/resolve`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ actual_minutes: actualMinutes, source: "manual" }),
      });
      const data = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: { message?: string } };
      if (!res.ok || data.ok !== true) {
        setError(data.error?.message ?? "Could not resolve");
        return;
      }
      router.push(`/result/${props.betSlug}`);
    } finally {
      setBusy(false);
    }
  }

  async function submitVoid(reason: VoidReason) {
    setError(null);
    setBusy(true);
    try {
      const res = await fetch(`/api/internal/orders/${props.orderId}/void`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ reason }),
      });
      const data = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: { message?: string } };
      if (!res.ok || data.ok !== true) {
        setError(data.error?.message ?? "Could not void");
        return;
      }
      router.push(`/result/${props.betSlug}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="slice-card p-5">
      <p className="slice-label text-[10px]" style={{ color: "var(--slice-muted)" }}>
        Host controls
      </p>
      <p className="mt-1 text-sm">
        Demo-day guaranteed resolution
      </p>

      {error ? (
        <p className="mt-3 text-sm" style={{ color: "var(--slice-red)" }}>
          {error}
        </p>
      ) : null}

      <div className="mt-4 space-y-3">
        <button
          type="button"
          onClick={() => setOpen("arrived")}
          disabled={busy}
          className="w-full rounded-[10px] py-4 text-base font-semibold text-white transition hover:brightness-105 disabled:opacity-60"
          style={{ background: "var(--slice-green)" }}
        >
          Food arrived
        </button>
        <button
          type="button"
          onClick={() => setOpen("void")}
          disabled={busy}
          className="slice-btn-secondary w-full py-3 text-sm disabled:opacity-60"
        >
          Something went wrong
        </button>
      </div>

      {open ? (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-3xl bg-white p-5 shadow-xl ring-1 ring-black/10">
            {open === "arrived" ? (
              <>
                <p className="text-sm font-semibold text-neutral-900">
                  How long did it actually take?
                </p>
                <p className="mt-1 text-xs text-neutral-500">
                  We’ll resolve picks using this time.
                </p>
                <label className="mt-4 block space-y-2">
                  <span className="text-xs font-medium text-neutral-600">Minutes</span>
                  <input
                    type="number"
                    min={1}
                    max={24 * 60}
                    value={actualMinutes}
                    onChange={(e) => setActualMinutes(Number(e.target.value))}
                    className="w-full rounded-2xl border border-neutral-200 bg-neutral-50 px-4 py-3.5 text-base outline-none ring-emerald-500/20 focus:border-emerald-600 focus:bg-white focus:ring-2"
                  />
                </label>
                <div className="mt-4 grid grid-cols-2 gap-3">
                  <button
                    type="button"
                    onClick={() => setOpen(null)}
                    disabled={busy}
                    className="rounded-2xl bg-neutral-100 py-3 text-sm font-semibold text-neutral-900 hover:bg-neutral-200 disabled:opacity-60"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={() => void submitArrived()}
                    disabled={busy}
                    className="rounded-2xl bg-emerald-600 py-3 text-sm font-semibold text-white hover:brightness-105 disabled:opacity-60"
                  >
                    {busy ? "Resolving…" : "Confirm"}
                  </button>
                </div>
              </>
            ) : (
              <>
                <p className="text-sm font-semibold text-neutral-900">
                  What happened?
                </p>
                <p className="mt-1 text-xs text-neutral-500">
                  We’ll void the bet (no points).
                </p>
                <div className="mt-4 space-y-2">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void submitVoid("cancelled")}
                    className="w-full rounded-2xl bg-neutral-100 px-4 py-3 text-left text-sm font-semibold text-neutral-900 hover:bg-neutral-200 disabled:opacity-60"
                  >
                    Order was cancelled
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void submitVoid("wrong_order")}
                    className="w-full rounded-2xl bg-neutral-100 px-4 py-3 text-left text-sm font-semibold text-neutral-900 hover:bg-neutral-200 disabled:opacity-60"
                  >
                    Wrong order
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void submitVoid("never_arrived")}
                    className="w-full rounded-2xl bg-neutral-100 px-4 py-3 text-left text-sm font-semibold text-neutral-900 hover:bg-neutral-200 disabled:opacity-60"
                  >
                    Never arrived
                  </button>
                </div>
                <button
                  type="button"
                  onClick={() => setOpen(null)}
                  disabled={busy}
                  className="mt-4 w-full rounded-2xl bg-white py-3 text-sm font-semibold text-neutral-700 ring-1 ring-neutral-200 hover:bg-neutral-50 disabled:opacity-60"
                >
                  Close
                </button>
              </>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}

