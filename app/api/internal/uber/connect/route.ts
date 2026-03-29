import { NextResponse } from "next/server";
import { z } from "zod";

import { getSession } from "@/lib/auth/session";
import { ensureHostByNextAuthUserId } from "@/lib/hosts/lookup";
import { extractCsrfToken, getPastOrders } from "@/lib/uber/client";
import { encryptUberSessionCookie } from "@/lib/uber/crypto";
import { createAdminClient } from "@/lib/supabase/admin";

const bodySchema = z.object({
  cookie: z.string().min(10).max(200_000),
  authorization_header: z.string().max(4000).optional().nullable(),
});

export async function POST(req: Request) {
  const session = await getSession();
  if (!session?.user?.id) {
    return NextResponse.json(
      { success: false, error: "Unauthorized" },
      { status: 401 },
    );
  }

  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return NextResponse.json(
      { success: false, error: "Invalid JSON" },
      { status: 400 },
    );
  }

  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { success: false, error: "Invalid body", issues: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const cookie = parsed.data.cookie.trim();
  const authHeader = parsed.data.authorization_header?.trim() || null;

  const uberSession = {
    cookie_string: cookie,
    x_csrf_token: extractCsrfToken(cookie) ?? null,
    authorization_header: authHeader,
  };

  let ordersFound = 0;
  try {
    const orders = await getPastOrders(uberSession, 25);
    ordersFound = orders.length;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json(
      { success: false, error: `Cookie validation failed: ${msg}` },
      { status: 400 },
    );
  }

  const hostId = await ensureHostByNextAuthUserId({
    nextauthUserId: session.user.id,
    email: session.user.email ?? null,
  });

  let ciphertext: string;
  try {
    ciphertext = encryptUberSessionCookie(cookie);
  } catch {
    return NextResponse.json(
      {
        success: false,
        error:
          "Server could not encrypt session. Set UBER_SESSION_ENCRYPTION_KEY (32-byte base64) or SUPABASE_SERVICE_ROLE_KEY.",
      },
      { status: 500 },
    );
  }

  const supabase = createAdminClient();
  const csrf = extractCsrfToken(cookie) ?? null;
  const { error } = await supabase.from("uber_sessions").upsert(
    {
      host_id: hostId,
      cookie_ciphertext: ciphertext,
      x_csrf_token: csrf,
      authorization_header: authHeader,
      validated_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
    { onConflict: "host_id" },
  );

  if (error) {
    console.error("uber_sessions upsert", error);
    return NextResponse.json(
      { success: false, error: "Failed to save session" },
      { status: 500 },
    );
  }

  return NextResponse.json({ success: true, orders_found: ordersFound });
}
