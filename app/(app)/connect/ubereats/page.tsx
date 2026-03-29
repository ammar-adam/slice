"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import { useSession } from "next-auth/react";

export default function ConnectUberEatsPage() {
  const { status } = useSession();
  const [cookie, setCookie] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<{
    kind: "ok" | "err";
    text: string;
  } | null>(null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setMessage(null);
    if (status !== "authenticated") {
      setMessage({ kind: "err", text: "Sign in first." });
      return;
    }
    const trimmed = cookie.trim();
    if (trimmed.length < 10) {
      setMessage({ kind: "err", text: "Paste your full cookie string from DevTools." });
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch("/api/internal/uber/connect", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ cookie: trimmed }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        success?: boolean;
        orders_found?: number;
        error?: string;
      };
      if (!res.ok || !data.success) {
        setMessage({
          kind: "err",
          text: data.error ?? "Could not connect. Check the cookie and try again.",
        });
        return;
      }
      setMessage({
        kind: "ok",
        text: `Connected. Uber returned ${data.orders_found ?? 0} recent order(s) in the check.`,
      });
      setCookie("");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="mx-auto max-w-lg space-y-6 pb-24">
      <div className="slice-card slice-fade-up p-4">
        <h1 className="slice-heading text-2xl">Connect Uber Eats</h1>
        <p className="mt-2 text-sm" style={{ color: "var(--slice-muted)" }}>
          Paste your Uber Eats session cookie so slice can load your orders and live tracking. No Gmail
          access is required.
        </p>
      </div>

      <ol
        className="slice-card list-decimal space-y-2 p-4 pl-8 text-sm"
        style={{ color: "var(--slice-text)" }}
      >
        <li>Open{" "}
          <a
            href="https://www.ubereats.com"
            target="_blank"
            rel="noreferrer"
            className="underline"
            style={{ color: "var(--slice-accent)" }}
          >
            ubereats.com
          </a>{" "}
          in a new tab
        </li>
        <li>Sign in if you are not already</li>
        <li>Open DevTools (F12) → Network tab</li>
        <li>Refresh the page</li>
        <li>Click any request to ubereats.com</li>
        <li>Under Request Headers, find <code className="text-xs">cookie</code></li>
        <li>Paste the entire cookie string below</li>
      </ol>

      <div
        className="slice-card border p-4 text-sm"
        style={{
          borderColor: "var(--slice-border2)",
          color: "var(--slice-muted)",
        }}
      >
        <p>
          Your Uber Eats cookie is stored securely (encrypted) and only used to sync your orders and poll
          active delivery status. It stops working when you log out of Uber Eats in the browser.
        </p>
      </div>

      <form onSubmit={(e) => void onSubmit(e)} className="slice-card space-y-4 p-4">
        <label className="block text-xs font-medium" style={{ color: "var(--slice-muted)" }}>
          Cookie string
        </label>
        <textarea
          value={cookie}
          onChange={(e) => setCookie(e.target.value)}
          rows={6}
          autoComplete="off"
          spellCheck={false}
          className="w-full resize-y rounded-xl border px-3 py-2 font-mono text-xs"
          style={{
            borderColor: "var(--slice-border2)",
            background: "var(--slice-surface2)",
            color: "var(--slice-text)",
          }}
          placeholder="sid=…; jwt-session=…; …"
        />
        {message ? (
          <p
            className="text-sm"
            style={{
              color: message.kind === "ok" ? "var(--slice-green)" : "var(--slice-red)",
            }}
            role="status"
          >
            {message.text}
          </p>
        ) : null}
        <button
          type="submit"
          disabled={submitting || status !== "authenticated"}
          className="slice-btn-primary w-full px-4 py-3 text-center text-sm disabled:opacity-60"
        >
          {submitting ? "Connecting…" : "Connect Uber Eats"}
        </button>
      </form>

      <p className="text-center text-xs" style={{ color: "var(--slice-muted)" }}>
        <Link href="/home" className="underline">
          Back to home
        </Link>
      </p>
    </main>
  );
}
