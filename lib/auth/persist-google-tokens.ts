import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import { GMAIL_READONLY_SCOPE } from "@/lib/auth/constants";

type UpsertArgs = {
  nextauthUserId: string;
  email?: string | null;
  googleSub?: string | null;
  refreshToken?: string | null;
  accessToken?: string | null;
  /** Unix timestamp in seconds from Google OAuth token response */
  accessTokenExpiresAtSec?: number | null;
  scopeString?: string | null;
};

/**
 * Persists host row and offline Gmail refresh token for Supabase Edge polling.
 * Called from NextAuth `jwt` when `account` is present (first OAuth callback).
 * TODO: encrypt refresh_token at rest before production hardening.
 */
export async function upsertHostAndGoogleTokens(args: UpsertArgs) {
  const supabase = createAdminClient();

  const { data: host, error: hostError } = await supabase
    .from("hosts")
    .upsert(
      {
        nextauth_user_id: args.nextauthUserId,
        email: args.email ?? null,
        google_sub: args.googleSub ?? null,
      },
      { onConflict: "nextauth_user_id" }
    )
    .select("id")
    .single();

  if (hostError || !host) {
    throw hostError ?? new Error("hosts upsert failed");
  }

  const scopesFromAccount =
    args.scopeString?.split(" ").filter(Boolean) ??
    [];

  const scopes =
    scopesFromAccount.length > 0
      ? scopesFromAccount
      : [GMAIL_READONLY_SCOPE, "email", "profile", "openid"];

  if (!scopes.includes(GMAIL_READONLY_SCOPE)) {
    scopes.push(GMAIL_READONLY_SCOPE);
  }

  if (args.refreshToken) {
    const expiresIso =
      args.accessTokenExpiresAtSec != null
        ? new Date(args.accessTokenExpiresAtSec * 1000).toISOString()
        : null;

    const { error: tokError } = await supabase.from("google_oauth_tokens").upsert(
      {
        host_id: host.id,
        refresh_token: args.refreshToken,
        access_token: args.accessToken ?? null,
        access_token_expires_at: expiresIso,
        scopes,
      },
      { onConflict: "host_id" }
    );

    if (tokError) {
      throw tokError;
    }
  }
}
