/**
 * Open-Meteo archive API — free, no key. Historical hourly precipitation (mm / preceding hour).
 */

export async function getWeatherAtTime(
  lat: number,
  lng: number,
  timestamp: Date
): Promise<{ precip_mm_hr: number }> {
  try {
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      return { precip_mm_hr: 0 };
    }

    const dateStr = timestamp.toISOString().slice(0, 10);
    const url = new URL("https://archive-api.open-meteo.com/v1/archive");
    url.searchParams.set("latitude", String(lat));
    url.searchParams.set("longitude", String(lng));
    url.searchParams.set("start_date", dateStr);
    url.searchParams.set("end_date", dateStr);
    url.searchParams.set("hourly", "precipitation");
    url.searchParams.set("timezone", "UTC");

    const res = await fetch(url.toString());
    if (!res.ok) return { precip_mm_hr: 0 };

    const json = (await res.json()) as {
      hourly?: { time?: string[]; precipitation?: (number | null)[] };
    };

    const times = json.hourly?.time;
    const precipitation = json.hourly?.precipitation;
    if (!times?.length || !precipitation?.length || times.length !== precipitation.length) {
      return { precip_mm_hr: 0 };
    }

    const targetMs = timestamp.getTime();
    let bestIdx = 0;
    let bestDiff = Infinity;

    for (let i = 0; i < times.length; i++) {
      const iso = times[i];
      if (typeof iso !== "string") continue;
      const ms = Date.parse(iso.endsWith("Z") ? iso : `${iso}Z`);
      if (Number.isNaN(ms)) continue;
      const diff = Math.abs(ms - targetMs);
      if (diff < bestDiff) {
        bestDiff = diff;
        bestIdx = i;
      }
    }

    const raw = precipitation[bestIdx];
    const mm = typeof raw === "number" && Number.isFinite(raw) ? Math.max(0, raw) : 0;
    return { precip_mm_hr: mm };
  } catch {
    return { precip_mm_hr: 0 };
  }
}
