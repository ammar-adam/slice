import { getPublicBetBySlug } from "@/lib/bets/public-bet";
import { isPublicBetPayload } from "@/lib/bets/public-bet-types";
import { BetPublicView } from "@/components/bets/bet-public-view";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

type Props = { params: { slug: string } };

export default async function BetPage(props: Props) {
  const payload = await getPublicBetBySlug(props.params.slug);

  if (!payload || !isPublicBetPayload(payload)) {
    return (
      <main className="mx-auto min-h-screen max-w-md bg-neutral-50 px-5 py-12">
        <div className="rounded-3xl bg-white p-8 text-center shadow-sm ring-1 ring-black/[0.06]">
          <p className="text-sm font-medium text-neutral-900">This bet link is invalid or expired.</p>
          <p className="mt-3 font-mono text-xs text-neutral-400">{props.params.slug}</p>
        </div>
      </main>
    );
  }

  // Need order_id for manual resolution trigger; public RPC payload intentionally omits it.
  const supabase = createAdminClient();
  const { data: betRow } = await supabase
    .from("bets")
    .select("order_id,status,resolve_deadline_at")
    .eq("public_slug", props.params.slug)
    .maybeSingle();

  const orderId =
    betRow && typeof (betRow as { order_id?: unknown }).order_id === "string"
      ? String((betRow as { order_id: string }).order_id)
      : null;

  const isOpen = payload.bet.status === "open";
  const deadlineMs = Date.parse(payload.bet.resolve_deadline_at);
  const pastDeadline = Number.isFinite(deadlineMs) && deadlineMs <= Date.now();

  return (
    <main className="mx-auto min-h-screen max-w-md bg-neutral-50 px-5 py-8">
      {isOpen && pastDeadline && orderId ? (
        <form
          method="post"
          action={`/api/internal/orders/${orderId}/resolve`}
          className="mb-4 rounded-3xl bg-white p-4 shadow-sm ring-1 ring-black/[0.06]"
        >
          <p className="text-sm font-semibold text-neutral-900">
            Bet is past its resolve deadline
          </p>
          <p className="mt-1 text-xs text-neutral-500">
            Click to check Gmail and resolve or void it.
          </p>
          <button
            type="submit"
            className="mt-3 w-full rounded-2xl bg-neutral-900 py-3 text-sm font-semibold text-white transition hover:brightness-110"
          >
            Check resolution
          </button>
        </form>
      ) : null}
      <BetPublicView slug={props.params.slug} initial={payload} />
    </main>
  );
}
