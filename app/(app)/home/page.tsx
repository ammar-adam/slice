"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useSession } from "next-auth/react";

type HostOrderRow = {
  id: string;
  restaurant_name: string;
  resolved?: boolean;
  status?: "open" | "resolved" | "void";
  delay_score?: number | null;
  order_placed_at: string;
};

function statusLabel(order: HostOrderRow) {
  if (order.status === "void") return "void";
  if (order.status === "resolved" || order.resolved) return "resolved";
  return "open";
}

export default function HomePage() {
  const { data: session, status } = useSession();
  const signedInEmail = session?.user?.email ?? null;

  const [orders, setOrders] = useState<HostOrderRow[]>([]);
  const [ordersLoading, setOrdersLoading] = useState(false);
  const [toast, setToast] = useState<{
    kind: "success" | "error";
    message: string;
  } | null>(null);

  const toastTimer = useMemo<{ id: number | null }>(() => ({ id: null }), []);

  function showToast(kind: "success" | "error", message: string) {
    setToast({ kind, message });
    if (toastTimer.id != null) window.clearTimeout(toastTimer.id);
    toastTimer.id = window.setTimeout(() => setToast(null), 3500);
  }

  async function refreshOrders() {
    setOrdersLoading(true);
    try {
      const res = await fetch("/api/internal/orders", { method: "GET" });
      const data = (await res.json().catch(() => ({}))) as {
        orders?: HostOrderRow[];
        error?: string;
      };
      if (!res.ok) {
        showToast(
          "error",
          typeof data.error === "string" ? data.error : "Could not load orders",
        );
        return;
      }
      setOrders(Array.isArray(data.orders) ? data.orders : []);
    } finally {
      setOrdersLoading(false);
    }
  }

  useEffect(() => {
    if (status !== "authenticated") return;
    let cancelled = false;
    (async () => {
      try {
        const sessRes = await fetch("/api/internal/uber/session");
        const sess = (await sessRes.json().catch(() => ({}))) as { connected?: boolean };
        if (!cancelled && sessRes.ok && sess.connected === true) {
          const syncRes = await fetch("/api/internal/uber/sync", { method: "POST" });
          const syncData = (await syncRes.json().catch(() => ({}))) as {
            synced?: number;
            error?: string;
          };
          if (!cancelled && syncRes.ok && typeof syncData.synced === "number" && syncData.synced > 0) {
            showToast("success", `${syncData.synced} new order${syncData.synced === 1 ? "" : "s"} imported`);
          } else if (!cancelled && syncRes.ok === false && syncData.error) {
            showToast("error", syncData.error);
          }
        }
      } catch {
        /* ignore */
      }
      if (!cancelled) await refreshOrders();
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  return (
    <main className="space-y-4 pb-24">
      {toast ? (
        <div
          className="slice-card sticky top-2 z-10 px-4 py-3 text-sm"
          style={{
            color: toast.kind === "success" ? "var(--slice-green)" : "var(--slice-red)",
            background: "var(--slice-surface2)",
          }}
          role="status"
        >
          {toast.message}
        </div>
      ) : null}

      <div className="slice-card slice-fade-up p-4" style={{ animationDelay: "0ms" }}>
        <p className="slice-label text-[10px]" style={{ color: "var(--slice-muted)" }}>
          Host
        </p>
        <h1 className="slice-heading mt-1 text-3xl">Your slice</h1>
        <p className="mt-2 text-sm" style={{ color: "var(--slice-muted)" }}>
          Signed in as{" "}
          <span style={{ color: "var(--slice-text)" }}>
            {signedInEmail ?? "friend"}
          </span>
        </p>
      </div>

      <p className="text-xs" style={{ color: "var(--slice-muted)" }}>
        Orders sync automatically when{" "}
        <Link href="/connect/ubereats" className="underline" style={{ color: "var(--slice-accent)" }}>
          Uber Eats is connected
        </Link>
        .
      </p>

      <section className="slice-card slice-fade-up p-4" style={{ animationDelay: "80ms" }}>
        <h2 className="slice-heading text-2xl">Recent orders</h2>
        {ordersLoading ? (
          <p className="slice-card mt-4 px-4 py-10 text-center text-sm" style={{ color: "var(--slice-muted)" }}>
            Loading…
          </p>
        ) : orders.length === 0 ? (
          <p className="slice-card mt-4 px-4 py-10 text-center text-sm" style={{ color: "var(--slice-muted)" }}>
            Order something and start a bet with your group
          </p>
        ) : (
          <ul className="mt-4 space-y-3">
            {orders.map((o) => (
              <li key={o.id} className="slice-card p-3">
                <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-base">{o.restaurant_name}</p>
                  <p className="mt-1 text-xs" style={{ color: "var(--slice-muted)" }}>
                    {new Date(o.order_placed_at).toLocaleString(undefined, {
                      month: "short",
                      day: "numeric",
                      hour: "numeric",
                      minute: "2-digit",
                    })}
                  </p>
                </div>
                <span
                  className="slice-label shrink-0 rounded-full px-2 py-1 text-[10px]"
                  style={{
                    color:
                      statusLabel(o) === "resolved"
                        ? "var(--slice-green)"
                        : statusLabel(o) === "void"
                          ? "var(--slice-red)"
                          : "var(--slice-muted)",
                    border: "1px solid var(--slice-border2)",
                  }}
                >
                  {statusLabel(o)}
                </span>
                </div>
                <p className="mt-3 text-sm" style={{ color: "var(--slice-muted)" }}>
                  delay score{" "}
                  <span className="slice-number text-xl" style={{ color: "var(--slice-text)" }}>
                    {Math.round((o.delay_score ?? 0) * 100)}%
                  </span>
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>

      <Link
        href="/create"
        className="slice-btn-primary slice-heading fixed bottom-4 left-1/2 w-[calc(100%-24px)] max-w-[406px] -translate-x-1/2 px-4 py-[14px] text-center text-lg"
      >
        New bet
      </Link>
    </main>
  );
}
