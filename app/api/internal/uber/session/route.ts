import { NextResponse } from "next/server";

import { getSession } from "@/lib/auth/session";
import { getHostIdByNextAuthUserId } from "@/lib/hosts/lookup";
import { createAdminClient } from "@/lib/supabase/admin";

export async function GET() {
  const session = await getSession();
  if (!session?.user?.id) {
    return NextResponse.json({ connected: false }, { status: 401 });
  }

  const hostId = await getHostIdByNextAuthUserId(session.user.id);
  if (!hostId) {
    return NextResponse.json({ connected: false });
  }

  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("uber_sessions")
    .select("host_id")
    .eq("host_id", hostId)
    .maybeSingle();

  if (error) {
    console.error("uber session check", error);
    return NextResponse.json({ connected: false });
  }

  return NextResponse.json({ connected: !!data });
}
