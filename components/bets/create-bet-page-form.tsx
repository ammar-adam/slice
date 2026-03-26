"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function CreateBetPageForm() {
  const router = useRouter();
  const [restaurantName, setRestaurantName] = useState("");
  const [etaMinutes, setEtaMinutes] = useState("35");
  const [showDare, setShowDare] = useState(false);
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
      if (!res.ok || !data.slug) {
        setError(typeof data.error === "string" ? data.error : "Failed to create bet");
        return;
      }
      router.push(`/bet/${data.slug}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="slice-card slice-fade-up space-y-4 p-4">
      <div>
        <label className="slice-heading mb-2 block text-2xl">restaurant name</label>
        <input
          required
          value={restaurantName}
          onChange={(e) => setRestaurantName(e.target.value)}
          className="slice-input w-full px-3 py-3"
          placeholder="e.g. Jinya Ramen"
        />
      </div>

      <div>
        <label className="slice-heading mb-2 block text-2xl">eta</label>
        <div className="relative">
          <input
            required
            type="number"
            min={1}
            max={240}
            value={etaMinutes}
            onChange={(e) => setEtaMinutes(e.target.value)}
            className="slice-input w-full px-3 py-3 pr-12"
          />
          <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm" style={{ color: "var(--slice-muted)" }}>
            min
          </span>
        </div>
      </div>

      <div>
        <button
          type="button"
          className="slice-btn-secondary mb-2 flex items-center gap-2 px-3 py-2 text-sm"
          onClick={() => setShowDare((v) => !v)}
        >
          + dare (optional)
        </button>
        {showDare ? (
          <textarea
            value={dareText}
            onChange={(e) => setDareText(e.target.value)}
            className="slice-input w-full resize-none px-3 py-3"
            rows={3}
            placeholder="Loser buys garlic knots"
          />
        ) : null}
      </div>

      {error ? (
        <p className="text-sm" style={{ color: "var(--slice-red)" }}>
          {error}
        </p>
      ) : null}

      <button type="submit" disabled={busy} className="slice-btn-primary w-full px-4 py-[14px]">
        {busy ? "Creating..." : "Create bet ->"}
      </button>
    </form>
  );
}
