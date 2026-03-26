import { NextResponse } from "next/server";

import { createAdminClient } from "@/lib/supabase/admin";

type Ctx = { params: { orderId: string } };

export async function POST(_req: Request, ctx: Ctx) {
  const orderId = ctx.params.orderId;
  if (!orderId || typeof orderId !== "string") {
    return NextResponse.json(
      { ok: false, error: { code: "invalid_order_id", message: "Invalid order id" } },
      { status: 400 }
    );
  }

  const supabase = createAdminClient();

  const { data, error } = await supabase.functions.invoke("resolve-bets", {
    body: { order_id: orderId },
  });

  if (error) {
    return NextResponse.json(
      {
        ok: false,
        error: { code: "edge_invoke_failed", message: error.message, details: error },
      },
      { status: 502 }
    );
  }

  return NextResponse.json({ ok: true, order_id: orderId, data });
}

