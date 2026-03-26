export type OrderStatus = "pending" | "resolved" | "void";

export type BetStatus = "open" | "resolved" | "void";

export type BetSide = "over" | "under";

export type OrderDTO = {
  id: string;
  hostId: string;
  restaurantName: string;
  etaInitialMinutes: number | null;
  orderPlacedAt: string;
  resolved: boolean;
};

export type BetDTO = {
  id: string;
  publicSlug: string;
  orderId: string;
  delayProbability: number;
  status: BetStatus;
  dareText: string | null;
};

export type ParticipantDTO = {
  id: string;
  displayName: string;
  side: BetSide;
  isCorrect: boolean | null;
  pointsDelta: number | null;
};
