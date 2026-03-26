import { NextResponse } from "next/server";
import { z } from "zod";

import { createAdminClient } from "@/lib/supabase/admin";

type Ctx = { params: { orderId: string } };

const bodySchema = z
  .object({
    actual_minutes: z.coerce.number().int().min(1).max(24 * 60).optional(),
    source: z.enum(["manual"]).optional(),
  })
  .optional();

export async function POST(req: Request, ctx: Ctx) {
  const orderId = ctx.params.orderId;
  if (!orderId || typeof orderId !== "string") {
    return NextResponse.json(
      { ok: false, error: { code: "invalid_order_id", message: "Invalid order id" } },
      { status: 400 }
    );
  }

  const supabase = createAdminClient();

  const bodyJson = await req.json().catch(() => undefined);
  const parsed = bodySchema?.safeParse(bodyJson);
  const actualMinutes =
    parsed && parsed.success ? parsed.data?.actual_minutes : undefined;

  const { data, error } = await supabase.functions.invoke("resolve-bets", {
    body: { order_id: orderId, actual_minutes: actualMinutes, source: "manual" },
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

