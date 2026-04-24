import "server-only";

import * as crypto from "crypto";

function timingSafeEqualString(a: string, b: string): boolean {
  try {
    const ab = Buffer.from(a, "utf8");
    const bb = Buffer.from(b, "utf8");
    if (ab.length !== bb.length) return false;
    return crypto.timingSafeEqual(ab, bb);
  } catch {
    return false;
  }
}

export function signWaMagicLink(wa_id: string, orderUuid: string, secret: string): string {
  return crypto.createHmac("sha256", secret).update(`${wa_id}|${orderUuid}`).digest("base64url");
}

export function verifyWaMagicLink(wa_id: string, orderUuid: string, sig: string, secret: string): boolean {
  if (!sig || sig.length > 400 || !wa_id || !orderUuid || !secret) return false;
  const expected = signWaMagicLink(wa_id, orderUuid, secret);
  return timingSafeEqualString(expected, sig);
}

export function getWhatsAppMagicSecret(): string | null {
  return process.env.WHATSAPP_INTERNAL_SECRET?.trim() || null;
}
