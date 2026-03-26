import "server-only";

import { RANKINGS_PUBLIC_MIN_RESOLVED_ORDERS } from "@/lib/product/rules";
import { createServerSupabase } from "@/lib/supabase/server";

export type RankingSummaryRow = {
  restaurantNameNormalized: string;
  displayName: string;
  resolvedOrderCount: number;
  isPublic: boolean;
};

export async function getRankingSummaries(): Promise<RankingSummaryRow[]> {
  let supabase;
  try {
    supabase = await createServerSupabase();
  } catch {
    return [];
  }

  const { data, error } = await supabase.rpc("get_restaurant_ranking_summaries");

  if (error) {
    console.error("get_restaurant_ranking_summaries", error);
    return [];
  }

  return (data ?? []).map((row) => {
    const count = Number(row.resolved_order_count);
    return {
      restaurantNameNormalized: row.restaurant_name_normalized,
      displayName: row.display_name,
      resolvedOrderCount: count,
      isPublic: count >= RANKINGS_PUBLIC_MIN_RESOLVED_ORDERS,
    };
  });
}
