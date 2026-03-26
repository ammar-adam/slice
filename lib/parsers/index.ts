import type { DeliveryPlatform } from "@/lib/parsers/config";
import { isPlatformIngestEnabled } from "@/lib/parsers/config";
import { parseDoorDashEmail } from "@/lib/parsers/doordash";
import { parseSkipEmail } from "@/lib/parsers/skip";
import type { ParsedOrder, ParsedOrderDraft } from "@/lib/parsers/types";
import {
  detectUberEatsEmailType,
  parseUberEatsEmail,
} from "@/lib/parsers/uber-eats";

export type { ParsedOrder, ParsedOrderDraft };
export { detectUberEatsEmailType };
export { parser_version } from "@/lib/parsers/uber-eats";

export function detectPlatformFromHeaders(args: {
  from?: string | null;
  subject?: string | null;
}): DeliveryPlatform {
  const blob = `${args.from ?? ""} ${args.subject ?? ""}`.toLowerCase();
  if (blob.includes("uber") || blob.includes("ubereats")) return "uber_eats";
  if (blob.includes("doordash") || blob.includes("door dash")) return "doordash";
  if (blob.includes("skip") || blob.includes("skipthedishes")) return "skip";
  return "unknown";
}

/**
 * Parses a delivery confirmation email body. Launch-blocking: Uber Eats.
 * Others return null unless feature-flagged (week 2).
 */
export function parseDeliveryEmail(args: {
  platform: DeliveryPlatform;
  htmlOrText: string;
  /** Gmail internalDate or message header Date — required for correct order_placed_at and delivery duration. */
  receivedAt?: Date;
  /** Required to compute actual_delivery_minutes on delivered emails. */
  orderPlacedAt?: Date;
}): ParsedOrderDraft | null {
  if (!isPlatformIngestEnabled(args.platform)) {
    return null;
  }

  switch (args.platform) {
    case "uber_eats": {
      const kind = detectUberEatsEmailType(args.htmlOrText);
      const partial = parseUberEatsEmail(
        args.htmlOrText,
        args.receivedAt ?? new Date(),
        { orderPlacedAt: args.orderPlacedAt }
      );
      if (kind === "unknown") {
        return null;
      }
      return {
        platform: "uber_eats",
        restaurantName: partial.restaurantName ?? "Unknown restaurant",
        etaInitialMinutes: partial.etaInitialMinutes,
        etaFinalMinutes: partial.etaFinalMinutes,
        orderPlacedAt: partial.orderPlacedAt,
        actualDeliveryMinutes: partial.actualDeliveryMinutes,
      };
    }
    case "doordash":
      return parseDoorDashEmail(args.htmlOrText);
    case "skip":
      return parseSkipEmail(args.htmlOrText);
    default:
      return null;
  }
}
