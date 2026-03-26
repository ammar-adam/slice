import type { DeliveryPlatform } from "@/lib/parsers/config";

/** Fields any Uber Eats email parser pass may contribute (partial per email type). */
export type ParsedOrder = {
  platform?: DeliveryPlatform;
  restaurantName?: string;
  etaInitialMinutes?: number;
  orderPlacedAt?: Date;
  etaFinalMinutes?: number;
  actualDeliveryMinutes?: number;
};

export type ParsedOrderDraft = {
  platform: DeliveryPlatform;
  restaurantName: string;
  etaInitialMinutes?: number;
  etaFinalMinutes?: number;
  orderPlacedAt?: Date;
  actualDeliveryMinutes?: number;
};
