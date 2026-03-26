/**
 * Uber Eats Gmail parser (v1) — Deno copy of lib/parsers/uber-eats semantics.
 */

export const parser_version = 1 as const;

export type UberEatsEmailKind = "placed" | "enroute" | "delivered" | "unknown";

export type ParsedOrderFields = {
  platform?: "uber_eats";
  restaurantName?: string;
  etaInitialMinutes?: number;
  orderPlacedAt?: Date;
  etaFinalMinutes?: number;
  actualDeliveryMinutes?: number;
};

function normalizeBodyForMatching(htmlOrText: string): string {
  try {
    let s = htmlOrText;
    s = s.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ");
    s = s.replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ");
    s = s.replace(/<br\s*\/?>/gi, "\n");
    s = s.replace(/<\/(p|div|table|tr|td|h[1-6]|li)>/gi, "\n");
    s = s.replace(/<[^>]+>/g, " ");
    s = decodeBasicHtmlEntities(s);
    s = s.replace(/\u00a0/g, " ");
    s = s.replace(/[\t\x0B\f\r]+/g, " ");
    s = s.replace(/\s+/g, " ");
    return s.trim();
  } catch {
    return "";
  }
}

function decodeBasicHtmlEntities(input: string): string {
  let s = input;
  s = s.replace(/&nbsp;/gi, " ");
  s = s.replace(/&amp;/gi, "&");
  s = s.replace(/&lt;/gi, "<");
  s = s.replace(/&gt;/gi, ">");
  s = s.replace(/&quot;/gi, '"');
  s = s.replace(/&#39;/g, "'");
  s = s.replace(/&#(\d+);/g, (_, n: string) => {
    try {
      const code = Number(n);
      if (!Number.isFinite(code)) return "";
      return String.fromCodePoint(code);
    } catch {
      return "";
    }
  });
  s = s.replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => {
    try {
      const code = parseInt(hex, 16);
      if (!Number.isFinite(code)) return "";
      return String.fromCodePoint(code);
    } catch {
      return "";
    }
  });
  return s;
}

export function detectUberEatsEmailType(body: string): UberEatsEmailKind {
  try {
    const text = normalizeBodyForMatching(body).toLowerCase();
    if (/\byour order has been delivered\b/.test(text)) {
      return "delivered";
    }
    if (
      /\byour order is on the way\b/.test(text) ||
      /\byour driver is on the way\b/.test(text)
    ) {
      return "enroute";
    }
    if (/\byour order has been placed\b/.test(text)) {
      return "placed";
    }
    return "unknown";
  } catch {
    return "unknown";
  }
}

function extractMinutesFromNow(text: string): number | undefined {
  const t = text.toLowerCase();
  const range = t.match(/(\d{1,2})\s*[-–]\s*(\d{1,2})\s*min(?:utes?)?/i);
  if (range) {
    const a = Number(range[1]);
    const b = Number(range[2]);
    if (Number.isFinite(a) && Number.isFinite(b) && a > 0 && b > 0) {
      return Math.round((a + b) / 2);
    }
  }
  const arrives = t.match(
    /(?:arriv\w*|estimated)\s+(?:in\s+)?(\d{1,2})\s*min(?:utes?)?/i,
  );
  if (arrives) {
    const n = Number(arrives[1]);
    if (Number.isFinite(n) && n > 0) return Math.round(n);
  }
  const loose = t.match(/\b(\d{1,2})\s*min(?:utes?)?\b/i);
  if (loose) {
    const n = Number(loose[1]);
    if (n >= 5 && n <= 120) return n;
  }
  return undefined;
}

function extractRestaurantName(text: string): string | undefined {
  const cleaned = text.replace(/\s+/g, " ").trim();
  const fromPat =
    /\bfrom\s+([A-Za-z0-9][A-Za-z0-9'&.\-–—]{1,60}?)(?=\s*(?:\||$|your order|estimated|min|minutes|•))/i;
  const m1 = cleaned.match(fromPat);
  if (m1?.[1]) {
    const name = m1[1].trim().replace(/[.,;]+$/, "");
    if (name.length >= 2) return name;
  }
  const orderFrom = cleaned.match(
    /\border\s+from\s+([A-Za-z0-9][A-Za-z0-9'&.\-–—]{1,60}?)(?=\s*(?:\||$|your|estimated))/i,
  );
  if (orderFrom?.[1]) {
    const name = orderFrom[1].trim().replace(/[.,;]+$/, "");
    if (name.length >= 2) return name;
  }
  return undefined;
}

function parsePlaced(
  normalizedText: string,
  receivedAt: Date,
): ParsedOrderFields {
  const etaInitialMinutes = extractMinutesFromNow(normalizedText);
  const restaurantName = extractRestaurantName(normalizedText);
  const out: ParsedOrderFields = {
    platform: "uber_eats",
    orderPlacedAt: receivedAt,
  };
  if (restaurantName !== undefined) out.restaurantName = restaurantName;
  if (etaInitialMinutes !== undefined) {
    out.etaInitialMinutes = etaInitialMinutes;
  }
  return out;
}

function parseEnroute(normalizedText: string): ParsedOrderFields {
  const etaFinalMinutes = extractMinutesFromNow(normalizedText);
  const out: ParsedOrderFields = { platform: "uber_eats" };
  if (etaFinalMinutes !== undefined) out.etaFinalMinutes = etaFinalMinutes;
  return out;
}

function parseDelivered(
  receivedAt: Date,
  orderPlacedAt?: Date,
): ParsedOrderFields {
  const out: ParsedOrderFields = { platform: "uber_eats" };
  if (orderPlacedAt) {
    const ms = receivedAt.getTime() - orderPlacedAt.getTime();
    if (Number.isFinite(ms) && ms >= 0) {
      out.actualDeliveryMinutes = Math.max(0, Math.round(ms / 60_000));
    }
  }
  return out;
}

export function parseUberEatsEmail(
  body: string,
  receivedAt: Date,
  context?: { orderPlacedAt?: Date },
): ParsedOrderFields {
  try {
    const kind = detectUberEatsEmailType(body);
    const normalized = normalizeBodyForMatching(body);
    switch (kind) {
      case "placed":
        return parsePlaced(normalized, receivedAt);
      case "enroute":
        return parseEnroute(normalized);
      case "delivered":
        return parseDelivered(receivedAt, context?.orderPlacedAt);
      default:
        return {};
    }
  } catch {
    return {};
  }
}

export function detectPlatformFromHeaders(args: {
  from?: string | null;
  subject?: string | null;
}): "uber_eats" | "doordash" | "skip" | "unknown" {
  const blob = `${args.from ?? ""} ${args.subject ?? ""}`.toLowerCase();
  if (blob.includes("uber") || blob.includes("ubereats")) return "uber_eats";
  if (blob.includes("doordash") || blob.includes("door dash")) {
    return "doordash";
  }
  if (blob.includes("skip") || blob.includes("skipthedishes")) return "skip";
  return "unknown";
}

export type ParsedIngestDraft = {
  platform: "uber_eats";
  kind: UberEatsEmailKind;
  restaurantName: string;
  etaInitialMinutes?: number;
  etaFinalMinutes?: number;
  orderPlacedAt?: Date;
  actualDeliveryMinutes?: number;
};

export function parseUberEatsForIngest(
  htmlOrText: string,
  receivedAt: Date,
  orderPlacedAt?: Date,
): ParsedIngestDraft | null {
  const kind = detectUberEatsEmailType(htmlOrText);
  if (kind === "unknown") return null;
  const partial = parseUberEatsEmail(htmlOrText, receivedAt, {
    orderPlacedAt,
  });
  return {
    platform: "uber_eats",
    kind,
    restaurantName: partial.restaurantName ?? "Unknown restaurant",
    etaInitialMinutes: partial.etaInitialMinutes,
    etaFinalMinutes: partial.etaFinalMinutes,
    orderPlacedAt: partial.orderPlacedAt,
    actualDeliveryMinutes: partial.actualDeliveryMinutes,
  };
}
