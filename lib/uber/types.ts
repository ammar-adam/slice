export type UberSession = {
  cookie_string: string;
  x_csrf_token?: string | null;
  authorization_header?: string | null;
};

export type UberOrderStatus = "DELIVERED" | "UPCOMING" | "ACTIVE" | string;

export type ParsedUberOrder = {
  uuid: string;
  restaurantName: string;
  orderPlacedAt: Date;
  estimatedDeliveryTime: Date | null;
  deliveryTime: Date | null;
  status: UberOrderStatus;
};

export type LiveOrderStatus = {
  currentStatus: "ORDER_PLACED" | "PICKUP" | "DROPOFF" | "DELIVERED" | string;
  estimatedArrivalTime: number | null;
  courierLocation: { latitude: number; longitude: number } | null;
  restaurantLocation: { latitude: number; longitude: number } | null;
  deliveryLocation: { latitude: number; longitude: number } | null;
  uberOrderUuid: string | null;
};
