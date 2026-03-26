import { NextResponse } from "next/server";

import { getSession } from "@/lib/auth/session";

export async function POST() {
  const session = await getSession();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  return NextResponse.json({
    ok: true,
    message: "Wire to Edge ingest in Fri milestone (5-minute poll).",
  });
}
