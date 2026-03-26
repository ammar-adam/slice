import "server-only";

import type { gmail_v1 } from "googleapis";

export async function getMessageFull(
  gmail: gmail_v1.Gmail,
  id: string
): Promise<gmail_v1.Schema$Message | null> {
  const res = await gmail.users.messages.get({
    userId: "me",
    id,
    format: "full",
  });
  return res.data;
}
