import { NextResponse } from "next/server";

import { getSession } from "@/lib/auth/session";

type Ctx = { params: { orderId: string } };

export async function GET(_req: Request, ctx: Ctx) {
  const session = await getSession();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  return NextResponse.json({ orderId: ctx.params.orderId });
}
