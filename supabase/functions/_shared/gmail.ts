import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const GMAIL_API = "https://gmail.googleapis.com/gmail/v1/users/me";

export type GoogleOAuthRow = {
  host_id: string;
  refresh_token: string;
  access_token: string | null;
  access_token_expires_at: string | null;
};

export type TokenBundle =
  | { ok: true; accessToken: string }
  | { ok: false; error: string; status?: number };

export async function refreshGoogleAccessToken(
  refreshToken: string,
): Promise<
  | { ok: true; accessToken: string; expiresAt: Date | null }
  | { ok: false; error: string; status?: number }
> {
  const clientId = Deno.env.get("GOOGLE_CLIENT_ID") ?? "";
  const clientSecret = Deno.env.get("GOOGLE_CLIENT_SECRET") ?? "";
  if (!clientId || !clientSecret) {
    return { ok: false, error: "missing_google_oauth_credentials" };
  }
  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: refreshToken,
    grant_type: "refresh_token",
  });
  let res: Response;
  try {
    res = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    });
  } catch (e) {
    return {
      ok: false,
      error: `token_network_error: ${e instanceof Error ? e.message : String(e)}`,
    };
  }
  let json: Record<string, unknown> = {};
  try {
    json = await res.json() as Record<string, unknown>;
  } catch {
    json = {};
  }
  if (!res.ok) {
    return {
      ok: false,
      error:
        typeof json.error === "string"
          ? json.error
          : "google_token_refresh_failed",
      status: res.status,
    };
  }
  const accessToken = json.access_token as string | undefined;
  const expiresIn = json.expires_in as number | undefined;
  if (!accessToken) {
    return { ok: false, error: "no_access_token_in_response" };
  }
  const expiresAt = typeof expiresIn === "number" && Number.isFinite(expiresIn)
    ? new Date(Date.now() + expiresIn * 1000)
    : null;
  return { ok: true, accessToken, expiresAt };
}

function tokenNeedsRefresh(row: GoogleOAuthRow, skewMs = 120_000): boolean {
  if (!row.access_token) return true;
  if (!row.access_token_expires_at) return true;
  const t = Date.parse(row.access_token_expires_at);
  if (!Number.isFinite(t)) return true;
  return t <= Date.now() + skewMs;
}

export async function ensureHostGmailAccessToken(
  supabase: SupabaseClient,
  row: GoogleOAuthRow,
): Promise<TokenBundle> {
  if (!tokenNeedsRefresh(row)) {
    return { ok: true, accessToken: row.access_token as string };
  }
  const refreshed = await refreshGoogleAccessToken(row.refresh_token);
  if (!refreshed.ok) {
    return {
      ok: false,
      error: refreshed.error,
      status: refreshed.status,
    };
  }
  const expiresIso = refreshed.expiresAt?.toISOString() ?? null;
  const { error: upErr } = await supabase.from("google_oauth_tokens").update({
    access_token: refreshed.accessToken,
    access_token_expires_at: expiresIso,
  }).eq("host_id", row.host_id);
  if (upErr) {
    return { ok: false, error: `persist_token_failed: ${upErr.message}` };
  }
  return { ok: true, accessToken: refreshed.accessToken };
}

// --- Gmail REST ---

export type GmailHeader = { name?: string; value?: string };
export type GmailMessagePart = {
  mimeType?: string;
  body?: { data?: string; attachmentId?: string };
  parts?: GmailMessagePart[];
};
export type GmailMessage = {
  id?: string;
  threadId?: string;
  internalDate?: string;
  snippet?: string;
  payload?: {
    mimeType?: string;
    body?: { data?: string };
    parts?: GmailMessagePart[];
    headers?: GmailHeader[];
  };
};

function decodeBase64Url(data: string): string {
  const b64 = data.replace(/-/g, "+").replace(/_/g, "/");
  const pad = b64.length % 4;
  const padded = pad ? b64 + "=".repeat(4 - pad) : b64;
  try {
    return atob(padded);
  } catch {
    return "";
  }
}

function collectBodies(part: GmailMessagePart | undefined, out: string[]) {
  if (!part) return;
  const mt = (part.mimeType ?? "").toLowerCase();
  if (
    (mt === "text/html" || mt === "text/plain") && part.body?.data
  ) {
    out.push(decodeBase64Url(part.body.data));
  }
  if (part.parts) {
    for (const p of part.parts) collectBodies(p, out);
  }
}

export function getMessageBodyText(msg: GmailMessage): string {
  const chunks: string[] = [];
  const root = msg.payload;
  if (root?.body?.data) {
    chunks.push(decodeBase64Url(root.body.data));
  }
  if (root?.parts) {
    for (const p of root.parts) collectBodies(p, chunks);
  }
  return chunks.join("\n");
}

export function getHeader(
  msg: GmailMessage,
  name: string,
): string | null {
  const headers = msg.payload?.headers ?? [];
  const l = name.toLowerCase();
  for (const h of headers) {
    if ((h.name ?? "").toLowerCase() === l) {
      return h.value ?? null;
    }
  }
  return null;
}

export function messageInternalDate(msg: GmailMessage): Date {
  const raw = msg.internalDate;
  if (raw) {
    const ms = Number(raw);
    if (Number.isFinite(ms)) return new Date(ms);
  }
  return new Date();
}

export async function listMessageIds(
  accessToken: string,
  query: string,
  maxPerPage = 100,
): Promise<
  { ok: true; ids: string[] } | { ok: false; error: string; status?: number }
> {
  const ids: string[] = [];
  let pageToken: string | undefined;
  try {
    do {
      const u = new URL(`${GMAIL_API}/messages`);
      u.searchParams.set("maxResults", String(maxPerPage));
      u.searchParams.set("q", query);
      if (pageToken) u.searchParams.set("pageToken", pageToken);
      const res = await fetch(u.toString(), {
        headers: { authorization: `Bearer ${accessToken}` },
      });
      const json = await res.json().catch(() => ({})) as {
        messages?: { id?: string }[];
        nextPageToken?: string;
        error?: { message?: string };
      };
      if (!res.ok) {
        return {
          ok: false,
          error: json.error?.message ?? "gmail_list_failed",
          status: res.status,
        };
      }
      for (const m of json.messages ?? []) {
        if (m.id) ids.push(m.id);
      }
      pageToken = json.nextPageToken;
    } while (pageToken);
  } catch (e) {
    return {
      ok: false,
      error: `gmail_list_network: ${e instanceof Error ? e.message : String(e)}`,
    };
  }
  return { ok: true, ids };
}

export async function getMessageFull(
  accessToken: string,
  id: string,
): Promise<
  | { ok: true; message: GmailMessage }
  | { ok: false; error: string; status?: number }
> {
  try {
    const u = new URL(`${GMAIL_API}/messages/${encodeURIComponent(id)}`);
    u.searchParams.set("format", "full");
    const res = await fetch(u.toString(), {
      headers: { authorization: `Bearer ${accessToken}` },
    });
    const json = await res.json().catch(() => ({})) as GmailMessage & {
      error?: { message?: string };
    };
    if (!res.ok) {
      return {
        ok: false,
        error: json.error?.message ?? "gmail_get_failed",
        status: res.status,
      };
    }
    return { ok: true, message: json };
  } catch (e) {
    return {
      ok: false,
      error:
        `gmail_get_network: ${e instanceof Error ? e.message : String(e)}`,
    };
  }
}

export async function getGmailHistoryId(
  accessToken: string,
): Promise<
  | { ok: true; historyId: string }
  | { ok: false; error: string; status?: number }
> {
  try {
    const res = await fetch(`${GMAIL_API}/profile`, {
      headers: { authorization: `Bearer ${accessToken}` },
    });
    const json = await res.json().catch(() => ({})) as {
      historyId?: string;
      error?: { message?: string };
    };
    if (!res.ok || !json.historyId) {
      return {
        ok: false,
        error: json.error?.message ?? "gmail_profile_failed",
        status: res.status,
      };
    }
    return { ok: true, historyId: String(json.historyId) };
  } catch (e) {
    return {
      ok: false,
      error:
        `gmail_profile_network: ${e instanceof Error ? e.message : String(e)}`,
    };
  }
}

/** Uber Eats inbox search — list-based; filter bodies in callers. */
export const UBER_EATS_GMAIL_QUERY_3H =
  `newer_than:3h (from:uber.com OR from:ubereats.com OR from:uber)`;

export const UBER_EATS_GMAIL_QUERY_30D =
  `newer_than:30d (from:uber.com OR from:ubereats.com OR from:uber)`;
