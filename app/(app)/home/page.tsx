import Link from "next/link";

import { getSession } from "@/lib/auth/session";
import { getHostIdByNextAuthUserId } from "@/lib/hosts/lookup";
import { listRecentOrdersForHost } from "@/lib/orders/queries";

function statusLabel(resolved: boolean) {
  return resolved ? "Delivered" : "In progress";
}

export default async function HomePage() {
  const session = await getSession();
  const hostId = session?.user?.id
    ? await getHostIdByNextAuthUserId(session.user.id)
    : null;
  const orders = hostId ? await listRecentOrdersForHost(hostId, 10) : [];

  return (
    <main className="space-y-6">
      <div className="rounded-3xl bg-white p-5 shadow-sm ring-1 ring-black/[0.06]">
        <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-slice-primary">
          Host
        </p>
        <h1 className="mt-1 text-2xl font-bold text-neutral-900">Your slice</h1>
        <p className="mt-2 text-sm text-neutral-600">
          Signed in as{" "}
          <span className="font-medium text-neutral-900">
            {session?.user?.email ?? "friend"}
          </span>
        </p>
      </div>

      <Link
        href="/create"
        className="flex w-full items-center justify-center rounded-2xl bg-slice-primary py-4 text-sm font-semibold text-white shadow-md shadow-orange-200/50 transition hover:brightness-105 active:scale-[0.99]"
      >
        Start a bet
      </Link>

      <section className="rounded-3xl bg-white p-5 shadow-sm ring-1 ring-black/[0.06]">
        <h2 className="text-sm font-semibold text-neutral-900">Recent orders</h2>
        {orders.length === 0 ? (
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
