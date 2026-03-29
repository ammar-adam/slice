import { NextResponse } from "next/server";

import { getSession } from "@/lib/auth/session";
import { getHostIdByNextAuthUserId } from "@/lib/hosts/lookup";
import { syncUberPastOrdersForHost } from "@/lib/uber/sync";

export async function POST() {
  const session = await getSession();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const hostId = await getHostIdByNextAuthUserId(session.user.id);
  if (!hostId) {
    return NextResponse.json({ synced: 0, skipped: true });
  }

  try {
    const synced = await syncUberPastOrdersForHost(hostId);
    return NextResponse.json({ synced });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg === "no_uber_session") {
      return NextResponse.json({ synced: 0, skipped: true });
    }
    console.error("uber sync", e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
