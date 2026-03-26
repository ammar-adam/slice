import { customAlphabet } from "nanoid";

const alphabet = "0123456789abcdefghijklmnopqrstuvwxyz";

/** URL-safe slug for /bet/[slug] share links */
export function createBetSlug(): string {
  return customAlphabet(alphabet, 8)();
}
