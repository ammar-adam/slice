/** Week-1: Uber Eats only at launch. DoorDash + Skip behind env flags for week 2. */
export const ENABLE_DOORDASH =
  process.env.ENABLE_DOORDASH === "true" || process.env.ENABLE_DOORDASH === "1";

export const ENABLE_SKIP =
  process.env.ENABLE_SKIP === "true" || process.env.ENABLE_SKIP === "1";

export type DeliveryPlatform = "uber_eats" | "doordash" | "skip" | "unknown";

export function isPlatformIngestEnabled(platform: DeliveryPlatform): boolean {
  if (platform === "uber_eats") return true;
  if (platform === "doordash") return ENABLE_DOORDASH;
  if (platform === "skip") return ENABLE_SKIP;
  return false;
}
