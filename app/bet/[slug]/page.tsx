import { getPublicBetBySlug } from "@/lib/bets/public-bet";
import { isPublicBetPayload } from "@/lib/bets/public-bet-types";
import { BetPublicView } from "@/components/bets/bet-public-view";

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

  return (
    <main className="mx-auto min-h-screen max-w-md bg-neutral-50 px-5 py-8">
      <BetPublicView slug={props.params.slug} initial={payload} />
    </main>
  );
}
