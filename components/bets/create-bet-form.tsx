"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

export function CreateBetForm() {
  const router = useRouter();
  const [restaurantName, setRestaurantName] = useState("");
  const [etaMinutes, setEtaMinutes] = useState("35");
  const [dareText, setDareText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const res = await fetch("/api/internal/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          restaurantName,
          etaMinutes: Number(etaMinutes),
          dareText: dareText.trim() || null,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as { slug?: string; error?: string };
      if (!res.ok) {
        setError(typeof data.error === "string" ? data.error : "Something went wrong");
        return;
      }
      if (data.slug) {
        router.push(`/bet/${data.slug}`);
        return;
      }
      setError("Missing slug in response");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto flex min-h-[calc(100vh-2rem)] max-w-md flex-col px-5 pb-10 pt-4">
      <header className="mb-6 flex items-center justify-between">
        <Link href="/home" className="text-sm font-bold text-slice-primary">
          Slice
        </Link>
        <span className="text-xs text-neutral-400">New bet</span>
      </header>

      <form
        onSubmit={onSubmit}
        className="flex flex-1 flex-col gap-4 rounded-3xl bg-white p-5 pb-8 shadow-sm ring-1 ring-black/[0.06]"
      >
        <div className="space-y-1">
          <p className="text-xs font-semibold uppercase tracking-wide text-slice-primary">
            Group bet
          </p>
          <h1 className="text-xl font-bold text-neutral-900">What are you ordering?</h1>
          <p className="text-sm text-neutral-500">
            One screen — share the link and let everyone pick a side.
          </p>
        </div>

        <label className="block space-y-2">
          <span className="text-xs font-medium text-neutral-600">Restaurant</span>
          <input
            required
            value={restaurantName}
            onChange={(e) => setRestaurantName(e.target.value)}
            placeholder={"e.g. Joe's Pizza"}
            autoComplete="off"
            className="w-full rounded-2xl border border-neutral-200 bg-neutral-50 px-4 py-3.5 text-base text-neutral-900 outline-none ring-slice-primary/30 transition placeholder:text-neutral-400 focus:border-slice-primary focus:bg-white focus:ring-2"
          />
        </label>

        <label className="block space-y-2">
          <span className="text-xs font-medium text-neutral-600">ETA (minutes)</span>
          <input
            required
            type="number"
            min={1}
            max={240}
            value={etaMinutes}
            onChange={(e) => setEtaMinutes(e.target.value)}
            className="w-full rounded-2xl border border-neutral-200 bg-neutral-50 px-4 py-3.5 text-base text-neutral-900 outline-none ring-slice-primary/30 transition focus:border-slice-primary focus:bg-white focus:ring-2"
          />
        </label>

        <label className="block space-y-2">
          <span className="text-xs font-medium text-neutral-600">Dare (optional)</span>
          <textarea
            value={dareText}
            onChange={(e) => setDareText(e.target.value)}
            placeholder="Loser buys next round"
            rows={3}
            className="w-full resize-none rounded-2xl border border-neutral-200 bg-neutral-50 px-4 py-3.5 text-base text-neutral-900 outline-none ring-slice-primary/30 transition placeholder:text-neutral-400 focus:border-slice-primary focus:bg-white focus:ring-2"
          />
        </label>

        {error ? (
          <p className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700 ring-1 ring-red-100">
            {error}
          </p>
        ) : null}

        <div className="mt-auto flex flex-col gap-3 pt-4">
          <button
            type="submit"
            disabled={busy}
            className="w-full rounded-2xl bg-slice-primary py-4 text-base font-semibold text-white shadow-md shadow-orange-200/50 transition hover:brightness-105 disabled:opacity-60"
          >
            {busy ? "Starting…" : "Start bet & get link"}
          </button>
          <Link
            href="/home"
            className="text-center text-sm font-medium text-neutral-500 hover:text-neutral-800"
          >
            Cancel
          </Link>
        </div>
      </form>
    </div>
  );
}
