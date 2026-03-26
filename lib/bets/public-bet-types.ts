import type { BetSide } from "@/types/domain";

export type PublicBetPayload = {
  bet: {
    id: string;
    public_slug: string;
    status: string;
    dare_text: string | null;
    delay_probability: number;
    resolve_deadline_at: string;
    resolved_at: string | null;
    voided_at: string | null;
    void_reason: string | null;
    created_at: string;
  };
  order: {
    restaurant_name: string;
    eta_initial_minutes: number | null;
    order_placed_at: string;
    resolved: boolean;
    actual_delivery_minutes: number | null;
    delay_score: number | null;
  };
  participants: Array<{
    id: string;
    display_name: string;
    side: BetSide;
    is_correct: boolean | null;
    points_delta: number | null;
    created_at: string;
  }>;
};

export function isPublicBetPayload(v: unknown): v is PublicBetPayload {
  if (!v || typeof v !== "object") return false;
  const o = v as Record<string, unknown>;
  const bet = o.bet;
  const order = o.order;
  const participants = o.participants;
  if (
    typeof bet !== "object" ||
    bet === null ||
    typeof order !== "object" ||
    order === null ||
    !Array.isArray(participants)
  ) {
    return false;
  }
  const b = bet as Record<string, unknown>;
  const ord = order as Record<string, unknown>;
  return (
    typeof b.id === "string" &&
    typeof b.public_slug === "string" &&
    typeof b.status === "string" &&
    typeof b.delay_probability === "number" &&
    typeof ord.restaurant_name === "string" &&
    typeof ord.order_placed_at === "string"
  );
}
