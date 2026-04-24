import "server-only";

import * as crypto from "crypto";

/**
 * Verifies Meta X-Hub-Signature-256 header against raw webhook body.
 */
export function verifyWebhookSignature(
  rawBody: string,
  signatureHeader: string | null,
  appSecret: string
): boolean {
  if (!signatureHeader || !appSecret || typeof rawBody !== "string") return false;
  const prefix = "sha256=";
  if (!signatureHeader.startsWith(prefix)) return false;
  const theirHex = signatureHeader.slice(prefix.length).trim();
  if (!/^[a-f0-9]{64}$/i.test(theirHex)) return false;
  const expected = crypto.createHmac("sha256", appSecret).update(rawBody, "utf8").digest("hex");
  try {
    return crypto.timingSafeEqual(Buffer.from(theirHex, "hex"), Buffer.from(expected, "hex"));
  } catch {
    return false;
  }
}
