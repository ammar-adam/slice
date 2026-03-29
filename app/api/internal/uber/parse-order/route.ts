import { NextResponse } from "next/server";
import { z } from "zod";

import { extractUberOrderUuidFromUrl } from "@/lib/uber/extract-order-uuid";
import { fetchUberOrderDetailsPublic } from "@/lib/uber/fetch-order-details-public";

const bodySchema = z.object({
  order_url: z.string().min(1).max(4000),
  uuid: z.string().uuid().optional(),
});

export async function POST(req: Request) {
  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid body", issues: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const { order_url: orderUrl, uuid: bodyUuid } = parsed.data;
  const uuid = extractUberOrderUuidFromUrl(orderUrl);
  if (!uuid) {
    return NextResponse.json({ error: "Invalid Uber Eats URL" }, { status: 400 });
  }
  if (bodyUuid != null && bodyUuid.toLowerCase() !== uuid.toLowerCase()) {
    return NextResponse.json({ error: "UUID does not match URL" }, { status: 400 });
  }

  const fetched = await fetchUberOrderDetailsPublic(uuid);

  const authBlocked = fetched.httpStatus === 401 || fetched.httpStatus === 403;
  const hasName = fetched.restaurant_name != null && fetched.restaurant_name.length > 0;
  const hasEta = fetched.eta_minutes != null && fetched.eta_minutes >= 1;
  const completeFromApi = hasName && hasEta && !authBlocked && fetched.ok;

  const needs_manual_input =
    authBlocked || !completeFromApi;

  return NextResponse.json({
    uuid,
    restaurant_name: authBlocked ? null : fetched.restaurant_name,
    eta_minutes: authBlocked ? null : fetched.eta_minutes,
    status: authBlocked ? null : fetched.order_status,
    needs_manual_input,
  });
}
