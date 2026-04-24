import "server-only";

import { sendWhatsAppMessage } from "./client";

export function betReadyMessage(slug: string): string {
  const base = (
    process.env.NEXT_PUBLIC_APP_URL ??
    process.env.NEXTAUTH_URL ??
    "https://slice.app"
  ).replace(/\/$/, "");
  return (
    `Your bet is ready! Share with friends:\n` +
    `${base}/bet/${slug}\n\n` +
    `Text ARRIVED when food shows up.`
  );
}

export async function sendBetReadyWhatsApp(wa_id: string, slug: string): Promise<boolean> {
  return sendWhatsAppMessage(wa_id, betReadyMessage(slug));
}
