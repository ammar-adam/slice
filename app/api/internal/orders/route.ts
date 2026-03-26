import { NextResponse } from "next/server";
import { z } from "zod";

import { getSession } from "@/lib/auth/session";
import { ensureHostByNextAuthUserId, getHostIdByNextAuthUserId } from "@/lib/hosts/lookup";
import { calculateDelayScore } from "@/lib/model/v1-weighted";
import { normalizeRestaurantName } from "@/lib/orders/normalize";
import { listRecentOrdersForHost } from "@/lib/orders/queries";
import { createBetSlug } from "@/lib/slug";
import { createAdminClient } from "@/lib/supabase/admin";

const createBodySchema = z.object({
  restaurantName: z.string().min(1).max(200),
  etaMinutes: z.coerce.number().int().min(1).max(240),
  dareText: z.string().max(500).optional().nullable(),
});

export async function GET() {
  const session = await getSession();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const hostId = await getHostIdByNextAuthUserId(session.user.id);
  if (!hostId) {
    return NextResponse.json({ orders: [] });
  }

  const orders = await listRecentOrdersForHost(hostId, 10);
  return NextResponse.json({ orders });
}

export async function POST(req: Request) {
  const session = await getSession();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = createBodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid body", issues: parsed.error.flatten() }, { status: 400 });
  }

  const { restaurantName, etaMinutes, dareText } = parsed.data;
  const name = restaurantName.trim();
  const dare =
    dareText?.trim() && dareText.trim().length > 0 ? dareText.trim() : null;

  const hostId = await ensureHostByNextAuthUserId({
    nextauthUserId: session.user.id,
    email: session.user.email ?? null,
  });

  const placedAt = new Date();
  const placedIso = placedAt.toISOString();
  // Manual bets have no map points yet; same coords → zero route distance, rest of model still runs.
  const delayScore = await calculateDelayScore({
    restaurant_name: name,
    eta_initial_minutes: etaMinutes,
    placed_at: placedAt,
    lat: 0,
    lng: 0,
    restaurant_lat: 0,
    restaurant_lng: 0,
  });

  const resolveDeadline = new Date(
    placedAt.getTime() + etaMinutes * 60_000 + 180 * 60_000
  );

  const supabase = createAdminClient();

  const { data: orderRow, error: orderError } = await supabase
    .from("orders")
    .insert({
      host_id: hostId,
      platform: "unknown",
      restaurant_name: name,
      restaurant_name_normalized: normalizeRestaurantName(name),
      eta_initial_minutes: etaMinutes,
      order_placed_at: placedIso,
      delay_score: delayScore,
    })
    .select("id")
    .single();

  if (orderError || !orderRow) {
    console.error("orders insert", orderError);
    return NextResponse.json({ error: "Failed to create order" }, { status: 500 });
  }

  const orderId = orderRow.id as string;

  let publicSlug: string | null = null;
  for (let attempt = 0; attempt < 8; attempt++) {
    const slugTry = createBetSlug();
    const { data: betRow, error: betError } = await supabase
      .from("bets")
      .insert({
        public_slug: slugTry,
        host_id: hostId,
        order_id: orderId,
        dare_text: dare,
        delay_probability: delayScore,
        status: "open",
        resolve_deadline_at: resolveDeadline.toISOString(),
      })
      .select("public_slug")
      .single();

    if (!betError && betRow) {
      publicSlug = betRow.public_slug as string;
      break;
    }

    if (
      betError &&
      typeof betError === "object" &&
      "code" in betError &&
      betError.code === "23505"
    ) {
      continue;
    }

    console.error("bets insert", betError);
    await supabase.from("orders").delete().eq("id", orderId);
    return NextResponse.json({ error: "Failed to create bet" }, { status: 500 });
  }

  if (!publicSlug) {
    await supabase.from("orders").delete().eq("id", orderId);
    return NextResponse.json({ error: "Could not allocate slug" }, { status: 500 });
  }

  return NextResponse.json({ slug: publicSlug });
}
