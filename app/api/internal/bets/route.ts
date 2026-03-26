import { NextResponse } from "next/server";
import { z } from "zod";

import { getSession } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/admin";
import { placeBet, type MarketState } from "@/lib/market/lmsr";

const placeBetSchema = z.object({
  slug: z.string().min(4).max(40),
  displayName: z
    .string()
    .max(40)
    .transform((s) => s.trim())
    .refine((s) => s.length > 0, { message: "Name required" }),
  side: z.enum(["over", "under"]),
});

export async function GET() {
  const session = await getSession();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  return NextResponse.json({ bets: [] });
}

/** Public: friends place picks from /bet/[slug] without signing in. */
export async function POST(req: Request) {
  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = placeBetSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid body", issues: parsed.error.flatten() }, { status: 400 });
  }

  const slug = parsed.data.slug.trim().toLowerCase();
  const displayName = parsed.data.displayName.trim();
  const side = parsed.data.side;

  const supabase = createAdminClient();

  const { data: bet, error: betError } = await supabase
    .from("bets")
    .select("id, status")
    .eq("public_slug", slug)
    .maybeSingle();

  if (betError) {
    console.error("bets lookup", betError);
    return NextResponse.json({ error: "Lookup failed" }, { status: 500 });
  }

  if (!bet) {
    return NextResponse.json({ error: "Bet not found" }, { status: 404 });
  }

  if (bet.status !== "open") {
    return NextResponse.json({ error: "Bet is closed" }, { status: 409 });
  }

  const betId = bet.id as string;

  const { error: insError } = await supabase.from("bet_participants").insert({
    bet_id: betId,
    display_name: displayName,
    side,
  });

  if (insError) {
    if (typeof insError === "object" && "code" in insError && insError.code === "23505") {
      return NextResponse.json(
        { error: "That name is already taken on this bet" },
        { status: 409 }
      );
    }
    console.error("bet_participants insert", insError);
    return NextResponse.json({ error: "Could not place pick" }, { status: 500 });
  }

  // Update LMSR market state (stored in bet_markets) and broadcast latest implied price.
  const { data: marketRowRaw } = await (supabase as any)
    .from("bet_markets")
    .select("lmsr_state")
    .eq("bet_id", betId)
    .maybeSingle();
  const marketRow = marketRowRaw as { lmsr_state?: unknown } | null;

  if (marketRow?.lmsr_state && typeof marketRow.lmsr_state === "object") {
    const s = marketRow.lmsr_state as MarketState;
    const { next, newPriceOver } = placeBet(s, side, 10);
    await (supabase as any).from("bet_markets").update({ lmsr_state: next }).eq("bet_id", betId);

    try {
      const channel = supabase.realtime.channel(`bet:${betId}`);
      await channel.send({
        type: "broadcast",
        event: "lmsr_update",
        payload: { price_over: newPriceOver, lmsr_state: next },
      });
      await supabase.realtime.removeChannel(channel);
    } catch {
      // best-effort
    }
  }

  return NextResponse.json({ ok: true });
}
