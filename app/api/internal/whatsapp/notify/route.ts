import { NextResponse } from "next/server";
import { z } from "zod";

import { sendBetReadyWhatsApp } from "@/lib/whatsapp/send-bet-ready";

const bodySchema = z.object({
  wa_id: z.string().min(1).max(64),
  bet_slug: z.string().min(4).max(40),
});

function authorize(req: Request): boolean {
  const secret = process.env.WHATSAPP_INTERNAL_SECRET?.trim();
  if (!secret) return false;
  const h = req.headers.get("authorization") ?? "";
  const prefix = "Bearer ";
  if (!h.startsWith(prefix)) return false;
  return h.slice(prefix.length).trim() === secret;
}

export async function POST(req: Request) {
  if (!authorize(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
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

  const ok = await sendBetReadyWhatsApp(parsed.data.wa_id, parsed.data.bet_slug.trim().toLowerCase());
  if (!ok) {
    return NextResponse.json({ error: "Failed to send WhatsApp message" }, { status: 502 });
  }
  return NextResponse.json({ ok: true });
}
