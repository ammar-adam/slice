import { NextResponse } from "next/server";
import { z } from "zod";

import { createAdminClient } from "@/lib/supabase/admin";

type Ctx = { params: { orderId: string } };

const bodySchema = z.object({
  reason: z.enum(["cancelled", "wrong_order", "never_arrived"]),
});

export async function POST(req: Request, ctx: Ctx) {
  const orderId = ctx.params.orderId;
  if (!orderId) {
    return NextResponse.json(
      { ok: false, error: { code: "invalid_order_id", message: "Invalid order id" } },
      { status: 400 }
    );
  }

  const json = await req.json().catch(() => null);
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: { code: "invalid_body", message: "Invalid body" } },
      { status: 400 }
    );
  }

  const supabase = createAdminClient();

  const nowIso = new Date().toISOString();

  const { data: betRows, error: bErr } = await supabase
    .from("bets")
    .select("id,status")
    .eq("order_id", orderId)
    .eq("status", "open");

  if (bErr) {
    return NextResponse.json(
      { ok: false, error: { code: "bets_lookup_failed", message: bErr.message } },
      { status: 500 }
    );
  }

  for (const b of betRows ?? []) {
    const betId = String((b as { id?: unknown }).id ?? "");
    if (!betId) continue;
    await supabase.from("bet_participants").update({ is_correct: null, points_delta: null }).eq(
      "bet_id",
      betId
    );
    await supabase.from("bets").update({
      status: "void",
      voided_at: nowIso,
      void_reason: `host_void:${parsed.data.reason}`,
    }).eq("id", betId);
  }

  const { error: oErr } = await supabase.from("orders").update({
    resolved: true,
    resolved_at: nowIso,
  }).eq("id", orderId);

  if (oErr) {
    return NextResponse.json(
      { ok: false, error: { code: "order_update_failed", message: oErr.message } },
      { status: 500 }
    );
  }

  return NextResponse.json({ ok: true, order_id: orderId });
}

