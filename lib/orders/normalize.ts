/**
 * Canonical restaurant normalization used everywhere (UI/manual orders + Edge Gmail ingest/resolve).
 *
 * Rules:
 * - lowercase
 * - remove diacritics (NFD + strip combining marks)
 * - remove all punctuation except ampersand (&)
 * - collapse whitespace
 * - trim
 *
 * Test cases (input -> output):
 * 1) "Café Déjà Vu" -> "cafe deja vu"
 * 2) "Joe's Pizza!!!" -> "joes pizza"
 * 3) "A&B  Sushi" -> "a&b sushi"
 * 4) "  Taco—Bell (Waterloo) " -> "tacobell waterloo"
 * 5) "Pita & Shawarma\t\tBar" -> "pita & shawarma bar"
 */
export function normalizeRestaurantName(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    // Keep letters/numbers/whitespace and '&'. Drop everything else (punctuation/symbols).
    .replace(/[^\p{L}\p{N}\s&]+/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}
