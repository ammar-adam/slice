import { NextResponse } from "next/server";

import { getSession } from "@/lib/auth/session";
import { getHostIdByNextAuthUserId } from "@/lib/hosts/lookup";
import { createAdminClient } from "@/lib/supabase/admin";

export async function POST() {
  const session = await getSession();
  if (!session?.user?.id) {
    return NextResponse.json(
      { ok: false, error: { code: "unauthorized", message: "Unauthorized" } },
      { status: 401 },
    );
  }

  const hostId = await getHostIdByNextAuthUserId(session.user.id);
  if (!hostId) {
    return NextResponse.json(
      {
        ok: false,
        error: { code: "host_not_found", message: "Host not found" },
      },
      { status: 404 },
    );
  }

  const supabase = createAdminClient();

  const { data, error } = await supabase.functions.invoke("ingest-mail", {
    body: { host_id: hostId },
  });

  if (error) {
    return NextResponse.json(
      {
        ok: false,
        error: {
          code: "edge_invoke_failed",
          message: error.message,
          details: error,
        },
      },
      { status: 502 },
    );
  }

  return NextResponse.json({ ok: true, host_id: hostId, data });
}
