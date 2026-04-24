import "server-only";

/**
 * Sends a plain-text WhatsApp message via Meta Graph API.
 * Never throws — logs errors and returns false on failure.
 */
export async function sendWhatsAppMessage(to: string, text: string): Promise<boolean> {
  const token = process.env.WHATSAPP_ACCESS_TOKEN;
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  if (!token || !phoneNumberId) {
    console.error("sendWhatsAppMessage: missing WHATSAPP_ACCESS_TOKEN or WHATSAPP_PHONE_NUMBER_ID");
    return false;
  }

  const url = `https://graph.facebook.com/v18.0/${phoneNumberId}/messages`;
  const body = {
    messaging_product: "whatsapp",
    to,
    type: "text",
    text: { body: text },
  };

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      console.error("sendWhatsAppMessage: Graph API error", res.status, errText.slice(0, 500));
      return false;
    }
    return true;
  } catch (e) {
    console.error("sendWhatsAppMessage: fetch failed", e);
    return false;
  }
}
