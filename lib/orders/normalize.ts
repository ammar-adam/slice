/** Normalized name for priors / indexing; keep in sync with ingestion when that exists. */
export function normalizeRestaurantName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]+/gu, "")
    .replace(/\s+/g, " ");
}
