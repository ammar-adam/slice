import "server-only";

export type InboundWhatsAppText = {
  wa_id: string;
  phone: string | null;
  message_id: string;
  text: string;
  timestamp: string | null;
};

function readString(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const s = v.trim();
  return s.length ? s : null;
}

/**
 * Parses Meta WhatsApp Cloud API webhook JSON for a single inbound user text message.
 */
export function parseWhatsAppWebhook(body: unknown): InboundWhatsAppText | null {
  if (!body || typeof body !== "object") return null;
  const root = body as Record<string, unknown>;
  const entry = root.entry;
  if (!Array.isArray(entry) || entry.length === 0) return null;

  for (const ent of entry) {
    if (!ent || typeof ent !== "object") continue;
    const changes = (ent as Record<string, unknown>).changes;
    if (!Array.isArray(changes)) continue;
    for (const ch of changes) {
      if (!ch || typeof ch !== "object") continue;
      const value = (ch as Record<string, unknown>).value;
      if (!value || typeof value !== "object") continue;
      const messages = (value as Record<string, unknown>).messages;
      if (!Array.isArray(messages) || messages.length === 0) continue;
      const msg = messages[0];
      if (!msg || typeof msg !== "object") continue;
      const m = msg as Record<string, unknown>;
      if (m.type !== "text") return null;
      const from = readString(m.from);
      if (!from) return null;
      const id = readString(m.id);
      if (!id) return null;
      const textObj = m.text;
      let textBody = "";
      if (textObj && typeof textObj === "object") {
        const tb = readString((textObj as Record<string, unknown>).body);
        if (tb) textBody = tb;
      }
      if (!textBody) return null;
      const ts = readString(m.timestamp);
      const contacts = (value as Record<string, unknown>).contacts;
      let phone: string | null = null;
      if (Array.isArray(contacts)) {
        for (const c of contacts) {
          if (!c || typeof c !== "object") continue;
          const wa = readString((c as Record<string, unknown>).wa_id);
          if (wa === from) {
            const profile = (c as Record<string, unknown>).profile as Record<string, unknown> | undefined;
            phone = profile ? readString(profile.name) : null;
            break;
          }
        }
      }
      return {
        wa_id: from,
        phone,
        message_id: id,
        text: textBody,
        timestamp: ts,
      };
    }
  }
  return null;
}
