"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

type ParseResponse = {
  uuid: string;
  restaurant_name: string | null;
  eta_minutes: number | null;
  status: string | null;
  needs_manual_input: boolean;
  error?: string;
};

export function CreateFromUberLinkForm() {
  const router = useRouter();
  const [step, setStep] = useState<"url" | "confirm">("url");
  const [orderUrl, setOrderUrl] = useState("");
  const [parsed, setParsed] = useState<ParseResponse | null>(null);
  const [restaurantName, setRestaurantName] = useState("");
  const [etaMinutes, setEtaMinutes] = useState("");
  const [showDare, setShowDare] = useState(false);
  const [dareText, setDareText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onParseSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const url = orderUrl.trim();
    if (url.length < 10) {
      setError("Paste a full Uber Eats order link.");
      return;
    }

    setBusy(true);
    try {
      const res = await fetch("/api/internal/uber/parse-order", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ order_url: url }),
      });
      const data = (await res.json().catch(() => ({}))) as ParseResponse & {
        error?: string;
      };

      if (!res.ok) {
        setError(typeof data.error === "string" ? data.error : "Could not read order link");
        return;
      }

      if (!data.uuid) {
        setError("Invalid response from server");
        return;
      }

      setParsed({
        uuid: data.uuid,
        restaurant_name: data.restaurant_name,
        eta_minutes: data.eta_minutes,
        status: data.status,
        needs_manual_input: data.needs_manual_input,
      });

      setRestaurantName(data.restaurant_name ?? "");
      setEtaMinutes(
        data.eta_minutes != null && data.eta_minutes > 0 ? String(data.eta_minutes) : "",
      );
      setStep("confirm");
    } finally {
      setBusy(false);
    }
  }

  async function onConfirmSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const name = restaurantName.trim();
    const eta = Number(etaMinutes);
    if (!name) {
      setError("Restaurant name is required.");
      return;
    }
    if (!Number.isFinite(eta) || eta < 1 || eta > 240) {
      setError("ETA must be between 1 and 240 minutes.");
      return;
    }
    if (!parsed?.uuid) {
      setError("Missing order id — go back and paste the link again.");
      return;
    }

    setBusy(true);
    try {
      const res = await fetch("/api/internal/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          restaurantName: name,
          etaMinutes: eta,
          dareText: dareText.trim() || null,
          uberOrderUuid: parsed.uuid,
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

  if (step === "confirm" && parsed) {
    return (
      <form onSubmit={(e) => void onConfirmSubmit(e)} className="slice-card slice-fade-up space-y-4 p-4">
        <p className="slice-heading text-2xl">Confirm your bet</p>
        <p className="text-sm" style={{ color: "var(--slice-muted)" }}>
          Order {parsed.uuid.slice(0, 8)}…
          {parsed.status ? ` · ${parsed.status}` : null}
        </p>

        {parsed.needs_manual_input ? (
          <>
            <p className="text-sm" style={{ color: "var(--slice-muted)" }}>
              We couldn&apos;t load details from Uber automatically. Enter them below.
            </p>
            <div>
              <label className="slice-heading mb-2 block text-xl">Restaurant name</label>
              <input
                required
                value={restaurantName}
                onChange={(e) => setRestaurantName(e.target.value)}
                className="slice-input w-full px-3 py-3"
                placeholder="e.g. Jinya Ramen"
              />
            </div>
            <div>
              <label className="slice-heading mb-2 block text-xl">ETA (minutes)</label>
              <input
                required
                type="number"
                min={1}
                max={240}
                value={etaMinutes}
                onChange={(e) => setEtaMinutes(e.target.value)}
                className="slice-input w-full px-3 py-3"
              />
            </div>
          </>
        ) : (
          <div className="slice-card space-y-2 p-4" style={{ background: "var(--slice-surface2)" }}>
            <p>
              <span className="text-sm" style={{ color: "var(--slice-muted)" }}>
                Restaurant
              </span>
              <br />
              <span className="text-lg">{restaurantName || "—"}</span>
            </p>
            <p>
              <span className="text-sm" style={{ color: "var(--slice-muted)" }}>
                ETA
              </span>
              <br />
              <span className="text-lg">
                {etaMinutes ? `${etaMinutes} min` : "—"}
              </span>
            </p>
          </div>
        )}

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

        <div className="flex flex-col gap-2 sm:flex-row">
          <button
            type="button"
            className="slice-btn-secondary w-full px-4 py-3"
            disabled={busy}
            onClick={() => {
              setStep("url");
              setParsed(null);
              setError(null);
            }}
          >
            Back
          </button>
          <button type="submit" disabled={busy} className="slice-btn-primary w-full px-4 py-[14px]">
            {busy ? "Creating…" : "Create bet →"}
          </button>
        </div>
      </form>
    );
  }

  return (
    <form onSubmit={(e) => void onParseSubmit(e)} className="slice-card slice-fade-up space-y-4 p-4">
      <div>
        <label className="slice-heading mb-2 block text-2xl">Paste your Uber Eats order link</label>
        <input
          required
          value={orderUrl}
          onChange={(e) => setOrderUrl(e.target.value)}
          className="slice-input w-full px-3 py-3 font-mono text-sm"
          placeholder="https://www.ubereats.com/orders/..."
          autoComplete="off"
        />
      </div>

      {error ? (
        <p className="text-sm" style={{ color: "var(--slice-red)" }}>
          {error}
        </p>
      ) : null}

      <button type="submit" disabled={busy} className="slice-btn-primary w-full px-4 py-[14px]">
        {busy ? "Looking up order…" : "Continue"}
      </button>
    </form>
  );
}
