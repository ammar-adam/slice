import { NextResponse } from "next/server";

import { ensureHostForWhatsApp } from "@/lib/hosts/lookup-whatsapp";
import { createAdminClient } from "@/lib/supabase/admin";
import { parseWhatsAppWebhook } from "@/lib/whatsapp/parse-inbound";
import { route } from "@/lib/whatsapp/message-router";
import { sendWhatsAppMessage } from "@/lib/whatsapp/client";
import { verifyWebhookSignature } from "@/lib/whatsapp/verify-signature";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const mode = url.searchParams.get("hub.mode");
  const token = url.searchParams.get("hub.verify_token");
  const challenge = url.searchParams.get("hub.challenge");
  const expected = process.env.WHATSAPP_VERIFY_TOKEN;
  if (mode === "subscribe" && token && expected && token === expected && challenge) {
    return new NextResponse(challenge, { status: 200 });
  }
  return new NextResponse("Forbidden", { status: 403 });
}

export async function POST(req: Request) {
  const secret = process.env.WHATSAPP_APP_SECRET;
  const rawBody = await req.text();
  const sig = req.headers.get("x-hub-signature-256");

  if (!secret || !verifyWebhookSignature(rawBody, sig, secret)) {
    return new NextResponse("Forbidden", { status: 403 });
  }

  let json: unknown;
  try {
    json = JSON.parse(rawBody);
  } catch {
    return new NextResponse("ok", { status: 200 });
  }

  const inbound = parseWhatsAppWebhook(json);
  if (!inbound) {
    return new NextResponse("ok", { status: 200 });
  }

  const supabase = createAdminClient();
  const { error: insErr } = await supabase.from("whatsapp_inbound_messages").insert({
    message_id: inbound.message_id,
    wa_id: inbound.wa_id,
    body: inbound.text,
  });

  if (insErr) {
    const code =
      typeof insErr === "object" && insErr && "code" in insErr
        ? String((insErr as { code: string }).code)
        : "";
    if (code !== "23505") {
      console.error("DB insert failed, skipping:", insErr);
      return new NextResponse("ok", { status: 200 });
    }
    return new NextResponse("ok", { status: 200 });
  }

  try {
    await ensureHostForWhatsApp(inbound.wa_id);
    const reply = await route(inbound.wa_id, inbound.text);
    await sendWhatsAppMessage(inbound.wa_id, reply);
  } catch (e) {
    console.error("whatsapp webhook handler", e);
    try {
      await sendWhatsAppMessage(
        inbound.wa_id,
        `Something went wrong on our side. Please try again in a minute, or reply HELP.`
      );
    } catch (_) {
      /* ignore */
    }
  }

  return new NextResponse("ok", { status: 200 });
}
