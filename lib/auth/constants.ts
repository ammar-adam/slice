/** Google OAuth scopes: profile/email + Gmail read-only for ingestion (Edge + server). */
export const GMAIL_READONLY_SCOPE = "https://www.googleapis.com/auth/gmail.readonly";

export const GOOGLE_OAUTH_SCOPES = [
  "openid",
  "email",
  "profile",
  GMAIL_READONLY_SCOPE,
] as const;
