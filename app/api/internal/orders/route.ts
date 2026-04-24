import { NextResponse } from "next/server";
import { z } from "zod";

import { getSession } from "@/lib/auth/session";
import { ensureHostByNextAuthUserId, getHostIdByNextAuthUserId } from "@/lib/hosts/lookup";
import { createBetFromParsed } from "@/lib/orders/create-bet-from-input";
import { listRecentOrdersForHost } from "@/lib/orders/queries";
import { verifyWaMagicLink, getWhatsAppMagicSecret } from "@/lib/whatsapp/magic-link";
import { sendBetReadyWhatsApp } from "@/lib/whatsapp/send-bet-ready";

const createBodySchema = z.object({
  restaurantName: z.string().min(1).max(200),
  etaMinutes: z.coerce.number().int().min(1).max(240),
  dareText: z.string().max(500).optional().nullable(),
  uberOrderUuid: z.string().uuid().optional().nullable(),
  notifyWaId: z.string().min(1).max(64).optional(),
  notifySig: z.string().min(1).max(500).optional(),
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

  const { restaurantName, etaMinutes, dareText, uberOrderUuid, notifyWaId, notifySig } = parsed.data;
  const name = restaurantName.trim();
  const dare =
    dareText?.trim() && dareText.trim().length > 0 ? dareText.trim() : null;
  const uberUuid =
    typeof uberOrderUuid === "string" && uberOrderUuid.trim().length > 0
      ? uberOrderUuid.trim()
      : null;

  const hostId = await ensureHostByNextAuthUserId({
    nextauthUserId: session.user.id,
    email: session.user.email ?? null,
  });

  const predictOrigin = new URL(req.url).origin;

  let slug: string;
  try {
    const out = await createBetFromParsed({
      host_id: hostId,
      restaurant_name: name,
      eta_minutes: etaMinutes,
      dare_text: dare,
      uber_order_uuid: uberUuid,
      predictOrigin,
    });
    slug = out.slug;
  } catch (e) {
    console.error("createBetFromParsed", e);
    return NextResponse.json({ error: "Failed to create bet" }, { status: 500 });
  }

  let whatsapp_sent = false;
  const nw = notifyWaId?.trim();
  const ns = notifySig?.trim();
  const secret = getWhatsAppMagicSecret();
  if (nw && ns && uberUuid && secret && verifyWaMagicLink(nw, uberUuid, ns, secret)) {
    whatsapp_sent = await sendBetReadyWhatsApp(nw, slug);
  }

  return NextResponse.json({ slug, whatsapp_sent });
}
