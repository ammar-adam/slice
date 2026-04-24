import { NextResponse } from "next/server";
import { z } from "zod";

import { createBetFromParsed } from "@/lib/orders/create-bet-from-input";
import { ensureHostForWhatsApp } from "@/lib/hosts/lookup-whatsapp";
import { verifyWaMagicLink, getWhatsAppMagicSecret } from "@/lib/whatsapp/magic-link";
import { sendBetReadyWhatsApp } from "@/lib/whatsapp/send-bet-ready";

const bodySchema = z.object({
  wa_id: z.string().min(1).max(64),
  uuid: z.string().uuid(),
  restaurantName: z.string().min(1).max(200),
  etaMinutes: z.coerce.number().int().min(1).max(240),
  dareText: z.string().max(500).optional().nullable(),
  sig: z.string().min(1).max(500),
});

function appBaseUrl(): string {
  return (
    process.env.NEXT_PUBLIC_APP_URL ??
    process.env.NEXTAUTH_URL ??
    "https://slice.app"
  ).replace(/\/$/, "");
}

export async function POST(req: Request) {
  const secret = getWhatsAppMagicSecret();
  if (!secret) {
    return NextResponse.json({ error: "Server misconfigured" }, { status: 500 });
  }

  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid body", issues: parsed.error.flatten() }, { status: 400 });
  }

  const { wa_id, uuid, restaurantName, etaMinutes, dareText, sig } = parsed.data;
  if (!verifyWaMagicLink(wa_id, uuid, sig, secret)) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 403 });
  }

  const hostId = await ensureHostForWhatsApp(wa_id);
  const dare =
    dareText != null && String(dareText).trim().length > 0 ? String(dareText).trim().slice(0, 500) : null;

  try {
    const { slug } = await createBetFromParsed({
      host_id: hostId,
      restaurant_name: restaurantName.trim(),
      eta_minutes: etaMinutes,
      dare_text: dare,
      uber_order_uuid: uuid,
      predictOrigin: appBaseUrl(),
    });
    await sendBetReadyWhatsApp(wa_id, slug);
    return NextResponse.json({ slug });
  } catch (e) {
    console.error("wa-complete", e);
    return NextResponse.json({ error: "Failed to create bet" }, { status: 500 });
  }
}
