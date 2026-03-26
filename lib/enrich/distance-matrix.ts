function haversineKm(
  originLat: number,
  originLng: number,
  destLat: number,
  destLng: number
): number {
  const R = 6371;
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(destLat - originLat);
  const dLng = toRad(destLng - originLng);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(originLat)) * Math.cos(toRad(destLat)) * Math.sin(dLng / 2) ** 2;
  const c = 2 * Math.asin(Math.min(1, Math.sqrt(a)));
  return R * c;
}

export async function getDrivingDistance(
  originLat: number,
  originLng: number,
  destLat: number,
  destLng: number
): Promise<{ distance_km: number }> {
  const straightLine = (): { distance_km: number } => ({
    distance_km: haversineKm(originLat, originLng, destLat, destLng),
  });

  try {
    if (
      !Number.isFinite(originLat) ||
      !Number.isFinite(originLng) ||
      !Number.isFinite(destLat) ||
      !Number.isFinite(destLng)
    ) {
      return straightLine();
    }

    const key = process.env.GOOGLE_MAPS_API_KEY;
    if (!key) return straightLine();

    const url = new URL("https://maps.googleapis.com/maps/api/distancematrix/json");
    url.searchParams.set("origins", `${originLat},${originLng}`);
    url.searchParams.set("destinations", `${destLat},${destLng}`);
    url.searchParams.set("mode", "driving");
    url.searchParams.set("units", "metric");
    url.searchParams.set("key", key);

    const res = await fetch(url.toString());
    if (!res.ok) return straightLine();

    const data = (await res.json()) as {
      status: string;
      rows?: {
        elements?: { status: string; distance?: { value: number } }[];
      }[];
    };

    if (data.status !== "OK") return straightLine();

    const element = data.rows?.[0]?.elements?.[0];
    if (!element || element.status !== "OK") return straightLine();

    const meters = element.distance?.value;
    if (typeof meters !== "number" || !Number.isFinite(meters) || meters < 0) {
      return straightLine();
    }

    return { distance_km: meters / 1000 };
  } catch {
    return straightLine();
  }
}
