import { NextResponse } from "next/server";

import { getSession } from "@/lib/auth/session";

type Ctx = { params: { betId: string } };

export async function GET(_req: Request, ctx: Ctx) {
  const session = await getSession();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  return NextResponse.json({ betId: ctx.params.betId });
}
