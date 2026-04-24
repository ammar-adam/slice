import "server-only";

const UUID_IN_PATH = /orders\/([a-zA-Z0-9-]{36})/i;

export function extractUberOrderUuidFromUrl(orderUrl: string): string | null {
  const trimmed = orderUrl.trim();
  if (!trimmed) return null;
  const m = trimmed.match(UUID_IN_PATH);
  return m?.[1] ?? null;
}
