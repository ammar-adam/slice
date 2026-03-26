import type { NextAuthOptions } from "next-auth";
import GoogleProvider from "next-auth/providers/google";

import { GOOGLE_OAUTH_SCOPES } from "@/lib/auth/constants";
import { upsertHostAndGoogleTokens } from "@/lib/auth/persist-google-tokens";

export const authOptions: NextAuthOptions = {
  session: { strategy: "jwt", maxAge: 30 * 24 * 60 * 60 },
  providers: [
    GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID ?? "",
      clientSecret: process.env.GOOGLE_CLIENT_SECRET ?? "",
      authorization: {
        params: {
          prompt: "consent",
          access_type: "offline",
          response_type: "code",
          scope: GOOGLE_OAUTH_SCOPES.join(" "),
        },
      },
    }),
  ],
  callbacks: {
    async jwt({ token, account, profile }) {
      if (account && profile) {
        token.email = profile.email ?? token.email;
        const email =
          typeof profile.email === "string"
            ? profile.email
            : token.email != null
              ? String(token.email)
              : undefined;
        const sub =
          typeof profile.sub === "string" ? profile.sub : undefined;
        const nextauthUserId =
          (typeof token.sub === "string" && token.sub) ||
          (typeof sub === "string" ? sub : null);

        if (nextauthUserId) {
          try {
            await upsertHostAndGoogleTokens({
              nextauthUserId,
              email,
              googleSub: sub,
              refreshToken: account.refresh_token ?? null,
              accessToken: account.access_token ?? null,
              accessTokenExpiresAtSec:
                typeof account.expires_at === "number"
                  ? account.expires_at
                  : null,
              scopeString:
                typeof account.scope === "string" ? account.scope : null,
            });
          } catch (e) {
            console.error("upsertHostAndGoogleTokens failed", e);
          }
        }
      }

      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        if (token.sub) {
          session.user.id = token.sub;
        }
        if (token.email) {
          session.user.email = typeof token.email === "string" ? token.email : undefined;
        }
      }
      return session;
    },
  },
  pages: {
    signIn: "/",
  },
  secret: process.env.NEXTAUTH_SECRET,
};
