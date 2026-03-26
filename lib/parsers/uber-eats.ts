import type { ParsedOrder } from "@/lib/parsers/types";

/**
 * Uber Eats Gmail HTML parser (v1).
 * Matches three lifecycle emails using body copy (not subject).
 */

export const parser_version = 1 as const;

export type UberEatsEmailKind = "placed" | "enroute" | "delivered" | "unknown";

// ---------------------------------------------------------------------------
// Inbox verification — body phrases used for TYPE detection (case-insensitive)
// ---------------------------------------------------------------------------
// TYPE 1 placed:     "Your order has been placed"
// TYPE 2 en route:   "Your order is on the way" | "Your driver is on the way"
// TYPE 3 delivered:  "Your order has been delivered"
// Subjects are intentionally NOT used for classification (high variance).

/** Strip tags/cruft so regex runs on approximate plain text; never throws. */
function normalizeBodyForMatching(htmlOrText: string): string {
  try {
    let s = htmlOrText;
    // Remove script/style blocks so we don't match marketing strings inside JS/CSS.
    s = s.replace(
      /<script\b[^>]*>[\s\S]*?<\/script>/gi,
      " "
    );
    s = s.replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ");

    // Block boundaries → space/newline (common in Uber marketing tables).
    s = s.replace(/<br\s*\/?>/gi, "\n");
    s = s.replace(/<\/(p|div|table|tr|td|h[1-6]|li)>/gi, "\n");
    // Drop remaining tags.
    s = s.replace(/<[^>]+>/g, " ");

    s = decodeBasicHtmlEntities(s);
    s = s.replace(/\u00a0/g, " ");
    // Collapse whitespace for phrase matching.
    s = s.replace(/[\t\x0B\f\r]+/g, " ");
    s = s.replace(/\s+/g, " ");
    return s.trim();
  } catch {
    return "";
  }
}

function decodeBasicHtmlEntities(input: string): string {
  let s = input;
  // Named entities often seen in Uber marketing emails.
  s = s.replace(/&nbsp;/gi, " ");
  s = s.replace(/&amp;/gi, "&");
  s = s.replace(/&lt;/gi, "<");
  s = s.replace(/&gt;/gi, ">");
  s = s.replace(/&quot;/gi, '"');
  s = s.replace(/&#39;/g, "'");
  // Numeric entities: &#37; or &#x2013; (en dash)
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

/**
 * Classify Uber Eats email by canonical body phrases from PRD.
 * Order: delivered → en route → placed (delivered copy wins if all appeared in a thread).
 */
export function detectUberEatsEmailType(body: string): UberEatsEmailKind {
  try {
    const text = normalizeBodyForMatching(body).toLowerCase();

    // TYPE 3 — "Your order has been delivered"
    // \b word boundaries reduce false positives on glued tokens.
    if (/\byour order has been delivered\b/.test(text)) {
      return "delivered";
    }

    // TYPE 2 — "Your order is on the way" OR "Your driver is on the way"
    if (
      /\byour order is on the way\b/.test(text) ||
      /\byour driver is on the way\b/.test(text)
    ) {
      return "enroute";
    }

    // TYPE 1 — "Your order has been placed"
    if (/\byour order has been placed\b/.test(text)) {
      return "placed";
    }

    return "unknown";
  } catch {
    return "unknown";
  }
}

/**
 * Minutes from a "min from now" ETA line (range → midpoint; single → value).
 * Patterns:
 * - "25-35 min" / "25 – 35 min" (ASCII hyphen or en dash U+2013)
 * - single "30 min" near "estimated"/"arrives"
 */
function extractMinutesFromNow(text: string): number | undefined {
  const t = text.toLowerCase();

  // Range: (\d{1,2})\s*[-–]\s*(\d{1,2})\s*min — accepts hyphen-minus or en dash between estimates.
  const range = t.match(
    /(\d{1,2})\s*[-–]\s*(\d{1,2})\s*min(?:utes?)?/i
  );
  if (range) {
    const a = Number(range[1]);
    const b = Number(range[2]);
    if (Number.isFinite(a) && Number.isFinite(b) && a > 0 && b > 0) {
      return Math.round((a + b) / 2);
    }
  }

  // "arrives in 25 minutes" / "arriving in 25 min"
  const arrives = t.match(
    /(?:arriv\w*|estimated)\s+(?:in\s+)?(\d{1,2})\s*min(?:utes?)?/i
  );
  if (arrives) {
    const n = Number(arrives[1]);
    if (Number.isFinite(n) && n > 0) return Math.round(n);
  }

  // Fallback: first "NN min" in the snippet (conservative: bounded 5–120).
  const loose = t.match(/\b(\d{1,2})\s*min(?:utes?)?\b/i);
  if (loose) {
    const n = Number(loose[1]);
    if (n >= 5 && n <= 120) return n;
  }

  return undefined;
}

/**
 * Restaurant name heuristics for confirmation emails.
 * 1) "from {Name}" in hero — From\s+ captures up to clause boundary.
 * 2) "Order from {Name}"
 * Name: starts with alnum, allows ampersand/apostrophe, stops before | extra Uber copy.
 */
function extractRestaurantName(text: string): string | undefined {
  const cleaned = text.replace(/\s+/g, " ").trim();

  // Pattern 1: "from Chipotle" / "from Joe's Pizza" — stop before " | " or known UX words.
  const fromPat =
    /\bfrom\s+([A-Za-z0-9][A-Za-z0-9'&.\-–—]{1,60}?)(?=\s*(?:\||$|your order|estimated|min|minutes|•))/i;
  const m1 = cleaned.match(fromPat);
  if (m1?.[1]) {
    const name = m1[1].trim().replace(/[.,;]+$/, "");
    if (name.length >= 2) return name;
  }

  // Pattern 2: "Order from Restaurant"
  const orderFrom = cleaned.match(/\border\s+from\s+([A-Za-z0-9][A-Za-z0-9'&.\-–—]{1,60}?)(?=\s*(?:\||$|your|estimated))/i);
  if (orderFrom?.[1]) {
    const name = orderFrom[1].trim().replace(/[.,;]+$/, "");
    if (name.length >= 2) return name;
  }

  return undefined;
}

function parsePlaced(normalizedText: string, receivedAt: Date): Partial<ParsedOrder> {
  const etaInitialMinutes = extractMinutesFromNow(normalizedText);
  const restaurantName = extractRestaurantName(normalizedText);

  const out: Partial<ParsedOrder> = {
    platform: "uber_eats",
    orderPlacedAt: receivedAt,
  };

  if (restaurantName !== undefined) out.restaurantName = restaurantName;
  if (etaInitialMinutes !== undefined) out.etaInitialMinutes = etaInitialMinutes;

  return out;
}

function parseEnroute(normalizedText: string): Partial<ParsedOrder> {
  const etaFinalMinutes = extractMinutesFromNow(normalizedText);
  const out: Partial<ParsedOrder> = { platform: "uber_eats" };
  if (etaFinalMinutes !== undefined) out.etaFinalMinutes = etaFinalMinutes;
  return out;
}

function parseDelivered(
  receivedAt: Date,
  orderPlacedAt?: Date
): Partial<ParsedOrder> {
  const out: Partial<ParsedOrder> = { platform: "uber_eats" };
  if (orderPlacedAt) {
    const ms = receivedAt.getTime() - orderPlacedAt.getTime();
    if (Number.isFinite(ms) && ms >= 0) {
      out.actualDeliveryMinutes = Math.max(0, Math.round(ms / 60_000));
    }
  }
  return out;
}

/**
 * Parse decoded Gmail HTML + received time.
 * - placed: restaurantName?, etaInitialMinutes?, orderPlacedAt (= receivedAt)
 * - enroute: etaFinalMinutes?
 * - delivered: actualDeliveryMinutes? only if `context.orderPlacedAt` is provided
 *
 * Never throws. Returns {} if type unknown or nothing extracted.
 */
export function parseUberEatsEmail(
  body: string,
  receivedAt: Date,
  context?: { orderPlacedAt?: Date }
): Partial<ParsedOrder> {
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
