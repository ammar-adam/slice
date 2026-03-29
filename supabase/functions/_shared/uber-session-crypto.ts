const IV_LEN = 12;
const TAG_LEN = 16;

async function keyFromServiceRole(): Promise<CryptoKey> {
  const sr = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "slice-dev-only";
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(sr));
  return crypto.subtle.importKey(
    "raw",
    digest,
    { name: "AES-GCM", length: 256 },
    false,
    ["decrypt"],
  );
}

async function importKey(): Promise<CryptoKey> {
  const raw = Deno.env.get("UBER_SESSION_ENCRYPTION_KEY") ?? "";
  if (raw.length >= 44) {
    try {
      const buf = Uint8Array.from(atob(raw), (c) => c.charCodeAt(0));
      if (buf.length === 32) {
        return crypto.subtle.importKey(
          "raw",
          buf,
          { name: "AES-GCM", length: 256 },
          false,
          ["decrypt"],
        );
      }
    } catch {
      // fall through
    }
  }
  return keyFromServiceRole();
}

/** Matches lib/uber/crypto.ts (AES-256-GCM, iv || ciphertext || tag) */
export async function decryptUberSessionCookie(stored: string): Promise<string> {
  const key = await importKey();
  const buf = Uint8Array.from(atob(stored), (c) => c.charCodeAt(0));
  if (buf.length < IV_LEN + TAG_LEN + 1) {
    throw new Error("invalid_cipher_blob");
  }
  const iv = buf.subarray(0, IV_LEN);
  const ct = buf.subarray(IV_LEN);
  const plain = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv, tagLength: 128 },
    key,
    ct,
  );
  return new TextDecoder().decode(plain);
}
