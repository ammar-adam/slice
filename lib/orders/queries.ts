import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";

export type HostOrderRow = {
  id: string;
  restaurant_name: string;
  resolved: boolean;
  order_placed_at: string;
};

export async function listRecentOrdersForHost(
  hostId: string,
  limit = 10
): Promise<HostOrderRow[]> {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("orders")
    .select("id, restaurant_name, resolved, order_placed_at")
    .eq("host_id", hostId)
    .order("order_placed_at", { ascending: false })
    .limit(limit);

  if (error) {
    console.error("orders list", error);
    return [];
  }

  return (data ?? []) as HostOrderRow[];
}
