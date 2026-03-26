import { getPublicBetBySlug } from "@/lib/bets/public-bet";
import { isPublicBetPayload } from "@/lib/bets/public-bet-types";
import { BetPublicView } from "@/components/bets/bet-public-view";
import { createAdminClient } from "@/lib/supabase/admin";
import { getSession } from "@/lib/auth/session";
import { getHostIdByNextAuthUserId } from "@/lib/hosts/lookup";
import { LiveOddsDisplay } from "@/components/bets/live-odds-display";
import { DriverMap } from "@/components/bets/driver-map";
import { HostControls } from "@/components/bets/host-controls";
import type { LMSRState } from "@/lib/market/lmsr";

export const dynamic = "force-dynamic";

type Props = { params: { slug: string } };

export default async function BetPage(props: Props) {
  const payload = await getPublicBetBySlug(props.params.slug);

  if (!payload || !isPublicBetPayload(payload)) {
    return (
      <main className="slice-page">
        <div className="slice-card p-8 text-center">
          <p className="text-sm">This bet link is invalid or expired.</p>
          <p className="mt-3 text-xs" style={{ color: "var(--slice-muted)" }}>
            {props.params.slug}
          </p>
        </div>
      </main>
    );
  }

  // Need order_id for manual resolution trigger; public RPC payload intentionally omits it.
  const supabase = createAdminClient();
  const { data: betRow } = await supabase
    .from("bets")
    .select("order_id,host_id,status,resolve_deadline_at")
    .eq("public_slug", props.params.slug)
    .maybeSingle();

  const orderId =
    betRow && typeof (betRow as { order_id?: unknown }).order_id === "string"
      ? String((betRow as { order_id: string }).order_id)
      : null;

  const isOpen = payload.bet.status === "open";
  const deadlineMs = Date.parse(payload.bet.resolve_deadline_at);
  const pastDeadline = Number.isFinite(deadlineMs) && deadlineMs <= Date.now();

  const session = await getSession();
  const viewerHostId = session?.user?.id
    ? await getHostIdByNextAuthUserId(session.user.id)
    : null;
  const betHostId =
    betRow && typeof (betRow as { host_id?: unknown }).host_id === "string"
      ? String((betRow as { host_id: string }).host_id)
      : null;
  const isHost = viewerHostId != null && betHostId != null && viewerHostId === betHostId;
  const betId = payload.bet.id;

  const { data: marketRowRaw } = await (supabase as any)
    .from("bet_markets")
    .select("lmsr_state")
    .eq("bet_id", betId)
    .maybeSingle();
  const marketRow = marketRowRaw as { lmsr_state?: unknown } | null;
  const initialLmsrState =
    marketRow?.lmsr_state && typeof marketRow.lmsr_state === "object"
      ? (marketRow.lmsr_state as LMSRState)
      : null;

  const { data: pathRowRaw } = orderId
    ? await (supabase as any)
      .from("order_driver_paths")
      .select("restaurant_lat,restaurant_lng,delivery_lat,delivery_lng")
      .eq("order_id", orderId)
      .maybeSingle()
    : { data: null };
  const pathRow = pathRowRaw as
    | { restaurant_lat?: number; restaurant_lng?: number; delivery_lat?: number; delivery_lng?: number }
    | null;

  return (
    <main className="slice-page">
      <header className="slice-fade-up mb-4" style={{ animationDelay: "0ms" }}>
        <h1 className="slice-heading text-3xl">{payload.order.restaurant_name}</h1>
        <p className="text-sm" style={{ color: "var(--slice-muted)" }}>
          ETA {payload.order.eta_initial_minutes ?? "--"} min
        </p>
      </header>

      {isOpen && pastDeadline && orderId ? (
        <form
          method="post"
          action={`/api/internal/orders/${orderId}/resolve`}
          className="slice-card mb-4 p-4"
        >
          <p className="text-sm">
            Bet is past its resolve deadline
          </p>
          <p className="mt-1 text-xs" style={{ color: "var(--slice-muted)" }}>
            Click to check Gmail and resolve or void it.
          </p>
          <button
            type="submit"
            className="slice-btn-secondary mt-3 w-full py-3 text-sm"
          >
            Check resolution
          </button>
        </form>
      ) : null}

      {orderId ? (
        <LiveOddsDisplay
          betId={betId}
          participantCount={payload.participants.length}
          initialProbability={Number(payload.bet.delay_probability)}
          initialLmsrState={initialLmsrState}
          etaInitialMinutes={payload.order.eta_initial_minutes ?? 1}
          etaFinalMinutes={null}
          orderPlacedAt={new Date(payload.order.order_placed_at)}
          orderId={orderId}
          resolved={Boolean(payload.order.resolved)}
        />
      ) : null}

      {orderId && pathRow ? (
        <div className="slice-fade-up mt-4" style={{ animationDelay: "80ms" }}>
          <DriverMap
            orderId={orderId}
            restaurantLat={Number(pathRow.restaurant_lat)}
            restaurantLng={Number(pathRow.restaurant_lng)}
            deliveryLat={Number(pathRow.delivery_lat)}
            deliveryLng={Number(pathRow.delivery_lng)}
            etaMinutes={payload.order.eta_initial_minutes ?? 30}
            orderPlacedAt={new Date(payload.order.order_placed_at)}
            pickupAt={null}
          />
        </div>
      ) : (
        <div className="slice-card slice-dot-grid slice-fade-up mt-4 p-5" style={{ animationDelay: "80ms" }}>
          <p className="slice-heading text-xl">Live tracking</p>
          <p className="mt-2 text-sm" style={{ color: "var(--slice-muted)" }}>
            Tracking will appear once driver is assigned.
          </p>
        </div>
      )}

      {isHost && orderId ? (
        <div className="slice-fade-up mt-4" style={{ animationDelay: "160ms" }}>
          <HostControls
            orderId={orderId}
            betSlug={props.params.slug}
            orderPlacedAt={new Date(payload.order.order_placed_at)}
          />
        </div>
      ) : null}

      <div className="slice-fade-up mt-4" style={{ animationDelay: "240ms" }}>
        <BetPublicView slug={props.params.slug} initial={payload} />
      </div>
    </main>
  );
}
