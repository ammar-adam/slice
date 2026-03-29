import "server-only";

import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

const IV_LEN = 12;
const TAG_LEN = 16;
const KEY_LEN = 32;

function getKey(): Buffer {
  const raw = process.env.UBER_SESSION_ENCRYPTION_KEY ?? "";
  if (raw.length >= 44) {
    try {
      const b = Buffer.from(raw, "base64");
      if (b.length === KEY_LEN) return b;
    } catch {
      /* fall through */
    }
  }
  if (raw.length === 64 && /^[0-9a-f]+$/i.test(raw)) {
    return Buffer.from(raw, "hex");
  }
  const fallback = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "slice-dev-only";
  return createHash("sha256").update(fallback, "utf8").digest();
}

/** base64(iv || ciphertext || authTag) */
export function encryptUberSessionCookie(plain: string): string {
  const key = getKey();
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, enc, tag]).toString("base64");
}

export function decryptUberSessionCookie(stored: string): string {
  const key = getKey();
  const buf = Buffer.from(stored, "base64");
  if (buf.length < IV_LEN + TAG_LEN + 1) {
    throw new Error("invalid_cipher_blob");
  }
  const iv = buf.subarray(0, IV_LEN);
  const tag = buf.subarray(buf.length - TAG_LEN);
  const data = buf.subarray(IV_LEN, buf.length - TAG_LEN);
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
}
