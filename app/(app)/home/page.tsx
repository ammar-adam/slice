\"use client\";

import Link from \"next/link\";
import { useEffect, useMemo, useState } from \"react\";
import { useSession } from \"next-auth/react\";

type HostOrderRow = {
  id: string;
  restaurant_name: string;
  resolved: boolean;
  order_placed_at: string;
};

function statusLabel(resolved: boolean) {
  return resolved ? "Delivered" : "In progress";
}

export default async function HomePage() {
  const { data: session, status } = useSession();
  const signedInEmail = session?.user?.email ?? null;

  const [orders, setOrders] = useState<HostOrderRow[]>([]);
  const [ordersLoading, setOrdersLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);

  const [toast, setToast] = useState<{
    kind: \"success\" | \"error\";
    message: string;
  } | null>(null);

  const toastTimer = useMemo<{ id: number | null }>(() => ({ id: null }), []);

  function showToast(kind: \"success\" | \"error\", message: string) {
    setToast({ kind, message });
    if (toastTimer.id != null) window.clearTimeout(toastTimer.id);
    toastTimer.id = window.setTimeout(() => setToast(null), 3500);
  }

  async function refreshOrders() {
    setOrdersLoading(true);
    try {
      const res = await fetch(\"/api/internal/orders\", { method: \"GET\" });
      const data = (await res.json().catch(() => ({}))) as {
        orders?: HostOrderRow[];
        error?: string;
      };
      if (!res.ok) {
        showToast(\"error\", typeof data.error === \"string\" ? data.error : \"Could not load orders\");
        return;
      }
      setOrders(Array.isArray(data.orders) ? data.orders : []);
    } finally {
      setOrdersLoading(false);
    }
  }

  async function syncOrders() {
    setSyncing(true);
    try {
      const res = await fetch(\"/api/internal/gmail/sync\", { method: \"POST\" });
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: { message?: string };
      };
      if (!res.ok || data.ok !== true) {
        showToast(\"error\", data.error?.message ?? \"Sync failed\");
        return;
      }
      showToast(\"success\", \"Synced Gmail orders\");
      await refreshOrders();
    } finally {
      setSyncing(false);
    }
  }

  useEffect(() => {
    if (status !== \"authenticated\") return;
    void refreshOrders();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  return (
    <main className="space-y-6">
      {toast ? (
        <div
          className={`sticky top-2 z-10 rounded-2xl px-4 py-3 text-sm font-medium ring-1 ${
            toast.kind === \"success\"
              ? \"bg-emerald-50 text-emerald-900 ring-emerald-100\"
              : \"bg-red-50 text-red-800 ring-red-100\"
          }`}
          role=\"status\"
        >
          {toast.message}
        </div>
      ) : null}

      <div className="rounded-3xl bg-white p-5 shadow-sm ring-1 ring-black/[0.06]">
        <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-slice-primary">
          Host
        </p>
        <h1 className="mt-1 text-2xl font-bold text-neutral-900">Your slice</h1>
        <p className="mt-2 text-sm text-neutral-600">
          Signed in as{" "}
          <span className="font-medium text-neutral-900">
            {signedInEmail ?? \"friend\"}
          </span>
        </p>
      </div>

      <button
        type=\"button\"
        onClick={() => void syncOrders()}
        disabled={syncing || status !== \"authenticated\"}
        className=\"flex w-full items-center justify-center rounded-2xl bg-white py-4 text-sm font-semibold text-neutral-900 shadow-sm ring-1 ring-black/[0.06] transition hover:bg-neutral-50 disabled:opacity-60\"
      >
        {syncing ? \"Syncing orders…\" : \"Sync orders\"}
      </button>

      <Link
        href="/create"
        className="flex w-full items-center justify-center rounded-2xl bg-slice-primary py-4 text-sm font-semibold text-white shadow-md shadow-orange-200/50 transition hover:brightness-105 active:scale-[0.99]"
      >
        Start a bet
      </Link>

      <section className="rounded-3xl bg-white p-5 shadow-sm ring-1 ring-black/[0.06]">
        <h2 className="text-sm font-semibold text-neutral-900">Recent orders</h2>
        {ordersLoading ? (
          <p className=\"mt-6 rounded-2xl bg-neutral-50 px-4 py-10 text-center text-sm text-neutral-500 ring-1 ring-black/[0.04]\">
            Loading…
          </p>
        ) : orders.length === 0 ? (
          <p className="mt-6 rounded-2xl bg-neutral-50 px-4 py-10 text-center text-sm text-neutral-500 ring-1 ring-black/[0.04]">
            Order something and start a bet with your group
          </p>
        ) : (
          <ul className="mt-4 divide-y divide-neutral-100">
            {orders.map((o) => (
              <li key={o.id} className="flex items-start justify-between gap-3 py-3 first:pt-0 last:pb-0">
                <div className="min-w-0">
                  <p className="truncate font-medium text-neutral-900">{o.restaurant_name}</p>
                  <p className="mt-0.5 text-xs text-neutral-400">
                    {new Date(o.order_placed_at).toLocaleString(undefined, {
                      month: "short",
                      day: "numeric",
                      hour: "numeric",
                      minute: "2-digit",
                    })}
                  </p>
                </div>
                <span
                  className={`shrink-0 rounded-full px-3 py-1 text-xs font-semibold ${
                    o.resolved
                      ? "bg-emerald-100 text-emerald-950"
                      : "bg-amber-100 text-amber-950"
                  }`}
                >
                  {statusLabel(o.resolved)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
