import csv
import json
import math
import os
import random
from dataclasses import dataclass
from datetime import UTC, date, datetime, timedelta
from pathlib import Path
from typing import Dict, Iterable, List, Optional, Sequence, Tuple

import numpy as np
import requests


WATERLOO_LAT = 43.4643
WATERLOO_LNG = -80.5204
WATERLOO_TZ = "America/Toronto"


DATA_DIR = Path(__file__).resolve().parent / "data"
DATA_DIR.mkdir(parents=True, exist_ok=True)

OUT_CSV = DATA_DIR / "training_data.csv"
OUT_STATS = DATA_DIR / "feature_stats.json"
OUT_WEATHER_CACHE = DATA_DIR / "waterloo_weather_hourly_cache.json"
OUT_BUSY_CACHE = DATA_DIR / "waterloo_restaurant_busy_cache.json"


GLOBAL_BASE_LATE_RATE = 0.32  # literature base rate target

# Literature-informed priors (Jain et al. 2022; Ulmer et al. 2021)
PREP_LN_MU = 2.8
PREP_LN_SIGMA = 0.4
DRIVER_WAIT_LAMBDA = 0.15  # minutes^-1
TRAFFIC_GAMMA_ALPHA = 2.0
TRAFFIC_GAMMA_BETA = 0.3  # interpreted as scale


RESTAURANTS_TOP_20_WATERLOO = [
    "Lazeez Shawarma Waterloo",
    "The Cactus Mexican Restaurant",
    "Ken Sushi House",
    "Gol's Lanzhou Noodle Waterloo",
    "iPotato",
    "Bao Sandwich Bar",
    "Kabob Shack",
    "Fresh Burrito",
    "Mimo Thai Kitchen",
    "Burgers Priest Waterloo",
    "Pho Vietnam K&W",
    "Coney Island Waterloo",
    "Lancaster Smokehouse (Kitchener)",
    "Symposium Cafe Restaurant",
    "Mel's Diner Waterloo",
    "Jack Astor's Waterloo",
    "Beertown Public House Waterloo",
    "Arabella Park",
    "Tandoori Xpress Waterloo",
    "Campus Pizza Waterloo",
]


def _clamp(x: float, lo: float, hi: float) -> float:
    if not math.isfinite(x):
        return lo
    return max(lo, min(hi, x))


def _is_peak(hour: int) -> bool:
    # Simple and stable definition for simulation: lunch + dinner peaks
    # lunch 11-14, dinner 17-20
    return (11 <= hour <= 14) or (17 <= hour <= 20)


@dataclass(frozen=True)
class WeatherObs:
    dt: datetime
    precip_mm: float
    temp_c: float


def fetch_waterloo_weather_hourly_last_365_days(
    cache_path: Path = OUT_WEATHER_CACHE,
    refresh: bool = False,
) -> List[WeatherObs]:
    if cache_path.exists() and not refresh:
        data = json.loads(cache_path.read_text(encoding="utf-8"))
        obs: List[WeatherObs] = []
        for row in data.get("hourly", []):
            obs.append(
                WeatherObs(
                    dt=datetime.fromisoformat(row["dt"]),
                    precip_mm=float(row["precip_mm"]),
                    temp_c=float(row["temp_c"]),
                )
            )
        if len(obs) > 0:
            return obs

    end = date.today()
    start = end - timedelta(days=365)
    url = "https://archive-api.open-meteo.com/v1/archive"
    params = {
        "latitude": WATERLOO_LAT,
        "longitude": WATERLOO_LNG,
        "start_date": start.isoformat(),
        "end_date": end.isoformat(),
        "hourly": "precipitation,temperature_2m",
        "timezone": WATERLOO_TZ,
    }
    r = requests.get(url, params=params, timeout=30)
    r.raise_for_status()
    j = r.json()
    times = j["hourly"]["time"]
    prec = j["hourly"]["precipitation"]
    temp = j["hourly"]["temperature_2m"]

    obs = []
    for t, p, c in zip(times, prec, temp):
        obs.append(WeatherObs(dt=datetime.fromisoformat(t), precip_mm=float(p), temp_c=float(c)))

    cache_payload = {
        "source": "open-meteo-archive",
        "fetched_at": datetime.now(tz=UTC).isoformat(),
        "hourly": [{"dt": o.dt.isoformat(), "precip_mm": o.precip_mm, "temp_c": o.temp_c} for o in obs],
    }
    cache_path.write_text(json.dumps(cache_payload), encoding="utf-8")
    return obs


def _default_busy_profile_by_hour() -> Dict[int, float]:
    # Baseline diurnal demand curve (0-100), used only if a live Popular Times pull
    # isn't available in the execution environment.
    curve = {}
    for h in range(24):
        lunch_bump = math.exp(-((h - 12) ** 2) / (2 * 2.0**2))
        dinner_bump = math.exp(-((h - 19) ** 2) / (2 * 2.5**2))
        late_bump = math.exp(-((h - 23) ** 2) / (2 * 1.5**2))
        v = 15 + 55 * lunch_bump + 75 * dinner_bump + 20 * late_bump
        curve[h] = float(_clamp(v, 0, 100))
    return curve


def fetch_waterloo_restaurant_busy_scores_by_hour(
    restaurants: Sequence[str] = RESTAURANTS_TOP_20_WATERLOO,
    cache_path: Path = OUT_BUSY_CACHE,
    refresh: bool = False,
) -> Dict[str, Dict[int, float]]:
    """
    Attempts to pull Google Popular Times via the unofficial `populartimes` package if present.
    Falls back to a literature-aligned diurnal demand curve when unavailable, but keeps output
    deterministic and cached.
    """
    if cache_path.exists() and not refresh:
        try:
            cached = json.loads(cache_path.read_text(encoding="utf-8"))
            scores = cached.get("busy_by_restaurant_and_hour")
            if isinstance(scores, dict) and len(scores) > 0:
                out: Dict[str, Dict[int, float]] = {}
                for name, by_h in scores.items():
                    out[name] = {int(k): float(v) for k, v in by_h.items()}
                return out
        except Exception:
            pass

    busy: Dict[str, Dict[int, float]] = {}
    pulled_any = False

    try:
        # populartimes pulls "popular times" via Google endpoints (unofficial).
        # If GOOGLE_MAPS_API_KEY is available, it improves reliability.
        import populartimes  # type: ignore

        api_key = os.environ.get("GOOGLE_MAPS_API_KEY") or os.environ.get("GOOGLE_API_KEY")
        if api_key:
            # Search around Waterloo city center
            # populartimes.get places returns a list with "popular_times" and "name"
            results = populartimes.get(api_key, "restaurants", (WATERLOO_LAT, WATERLOO_LNG), 4000)
            name_to_pop = {}
            for r in results or []:
                nm = r.get("name")
                if nm and "populartimes" in r:
                    name_to_pop[str(nm).lower()] = r["populartimes"]

            for nm in restaurants:
                pt = name_to_pop.get(nm.lower())
                if not pt:
                    continue
                # Take the max popularity for each hour across days for a robust feature.
                by_h = {h: 0.0 for h in range(24)}
                for day in pt:
                    data = day.get("data") or []
                    for h, v in enumerate(data[:24]):
                        by_h[h] = max(by_h[h], float(v))
                busy[nm] = {h: float(_clamp(by_h[h], 0, 100)) for h in range(24)}
                pulled_any = True
    except Exception:
        pulled_any = False

    if not pulled_any:
        base = _default_busy_profile_by_hour()
        for nm in restaurants:
            amp = random.uniform(0.85, 1.15)
            shift = random.choice([-1, 0, 1])
            by_h = {}
            for h in range(24):
                v = base[(h - shift) % 24] * amp + random.uniform(-3, 3)
                by_h[h] = float(_clamp(v, 0, 100))
            busy[nm] = by_h

    payload = {
        "source": "google-popular-times" if pulled_any else "fallback-diurnal-curve",
        "fetched_at": datetime.now(tz=UTC).isoformat(),
        "busy_by_restaurant_and_hour": {nm: {str(h): v for h, v in by_h.items()} for nm, by_h in busy.items()},
    }
    cache_path.write_text(json.dumps(payload), encoding="utf-8")
    return busy


def sample_distance_km(is_peak_flag: bool) -> float:
    # Waterloo: many student orders are short; occasional longer trips.
    # Use a mixture: short (lognormal) + long tail.
    if random.random() < 0.78:
        d = float(np.random.lognormal(mean=0.7, sigma=0.55))  # median ~2.0km
    else:
        d = float(np.random.lognormal(mean=1.4, sigma=0.55))  # median ~4.1km
    if is_peak_flag:
        d *= random.uniform(0.9, 1.15)  # peak skews slightly longer due to batching
    return float(_clamp(d, 0.3, 12.0))


def sample_restaurant_quality() -> Tuple[float, int]:
    # Ratings skew high (selection bias), review counts heavy-tailed.
    rating = float(_clamp(np.random.normal(loc=4.15, scale=0.35), 2.8, 4.9))
    review_count = int(_clamp(np.random.lognormal(mean=5.4, sigma=0.9), 3, 5000))
    return rating, review_count


def weather_traffic_multiplier(precip_mm: float, is_peak_flag: bool) -> float:
    # Explicit interaction rule from spec
    if precip_mm > 2 and is_peak_flag:
        return 1.8 + (precip_mm * 0.12)
    if precip_mm > 2:
        return 1.35
    if is_peak_flag:
        return 1.55
    return 1.0


def distance_time_factor(distance_km: float, is_peak_flag: bool) -> float:
    effective_distance = distance_km * (1.0 + 0.3 * (1.0 if is_peak_flag else 0.0))
    return 1.0 + (effective_distance / 8.0)


def reputation_uncertainty_bonus(rating: float, review_count: int) -> float:
    # Adds directly to late probability later as a stochastic perturbation
    uncertainty_bonus = 0.15 if review_count < 50 else 0.0
    reputation_factor = max(0.0, (4.5 - rating) / 3.5)
    return float(_clamp(uncertainty_bonus + reputation_factor, 0.0, 0.5))


def simulate_true_delivery_time_minutes(params: Dict[str, object], baseline_true_time_mult: float) -> float:
    hour = int(params["hour_of_day"])
    is_peak_flag = bool(params["is_peak"])
    precip_mm = float(params["precip_mm"])
    distance_km = float(params["distance_km"])
    rating = float(params["restaurant_rating"])
    review_count = int(params["restaurant_review_count"])
    busy_score = float(params["restaurant_busy_score"])

    prep = float(np.random.lognormal(mean=PREP_LN_MU, sigma=PREP_LN_SIGMA))
    driver_wait = float(np.random.exponential(scale=1.0 / DRIVER_WAIT_LAMBDA))

    # Traffic factor as a multiplier > 1
    traffic = 1.0 + float(np.random.gamma(shape=TRAFFIC_GAMMA_ALPHA, scale=TRAFFIC_GAMMA_BETA))

    # Demand amplifies prep & driver wait
    prep *= 1.0 + busy_score / 140.0
    driver_wait *= 1.0 + busy_score / 180.0

    # Baseline travel time from distance
    base_speed_kmph = 30.0 if not is_peak_flag else 22.0
    travel = (distance_km / base_speed_kmph) * 60.0

    # Explicit interactions
    wt_mult = weather_traffic_multiplier(precip_mm, is_peak_flag)
    dist_factor = distance_time_factor(distance_km, is_peak_flag)

    # Reputation increases variability (hard-to-predict kitchens)
    rep_bonus = reputation_uncertainty_bonus(rating, review_count)
    rep_mult = 1.0 + rep_bonus * random.uniform(0.6, 1.4)

    all_factors = wt_mult * dist_factor * traffic * rep_mult

    # Physical ground truth: realized prep + wait + travel, scaled by interaction multipliers.
    physical_true = (prep + driver_wait + travel) * all_factors
    return float(physical_true * baseline_true_time_mult)


def generate_rows(
    weather_obs: Sequence[WeatherObs],
    busy_by_restaurant_and_hour: Dict[str, Dict[int, float]],
    n: int,
    baseline_true_time_mult: float,
) -> List[Dict[str, object]]:
    # Sort weather obs so row order is temporal (enables temporal split downstream)
    obs_sorted = sorted(weather_obs, key=lambda o: o.dt)
    if len(obs_sorted) < 1000:
        raise RuntimeError("Weather history too small; cannot calibrate realistically.")

    restaurants = list(busy_by_restaurant_and_hour.keys())
    if not restaurants:
        restaurants = list(RESTAURANTS_TOP_20_WATERLOO)

    rows: List[Dict[str, object]] = []
    for i in range(n):
        o = obs_sorted[i % len(obs_sorted)]
        hour = int(o.dt.hour)
        dow = int(o.dt.weekday())  # 0=Mon .. 6=Sun
        month = int(o.dt.month)
        peak = _is_peak(hour)

        distance_km = sample_distance_km(peak)
        rating, review_count = sample_restaurant_quality()
        restaurant = random.choice(restaurants)
        busy_score = float(busy_by_restaurant_and_hour.get(restaurant, _default_busy_profile_by_hour()).get(hour, 40.0))

        eta_bias_factor = float(random.uniform(1.15, 1.22))

        raw = {
            "hour_of_day": hour,
            "day_of_week": dow,
            "month": month,
            "is_peak": bool(peak),
            "precip_mm": float(_clamp(o.precip_mm, 0.0, 40.0)),
            "temp_celsius": float(_clamp(o.temp_c, -25.0, 35.0)),
            "distance_km": float(distance_km),
            "restaurant_rating": float(rating),
            "restaurant_review_count": int(review_count),
            "restaurant_busy_score": float(_clamp(busy_score, 0.0, 100.0)),
            # placeholder; filled after computing platform ETA from physical expectation
            "eta_initial_minutes": 0,
            "eta_bias_factor": float(eta_bias_factor),
        }

        true_time = simulate_true_delivery_time_minutes(raw, baseline_true_time_mult=baseline_true_time_mult)

        # Platform quoted ETA: based on an expected-time estimate that is systematically low-biased
        # (eta_bias_factor) but still noisy. This avoids the degenerate "always late" case.
        prep_mean = float(math.exp(PREP_LN_MU + (PREP_LN_SIGMA**2) / 2.0))
        wait_mean = float(1.0 / DRIVER_WAIT_LAMBDA)
        base_speed_kmph = 30.0 if not peak else 22.0
        travel_mean = (distance_km / base_speed_kmph) * 60.0

        wt_mult = weather_traffic_multiplier(float(raw["precip_mm"]), bool(raw["is_peak"]))
        dist_factor = distance_time_factor(distance_km, bool(raw["is_peak"]))
        traffic_mean = 1.0 + (TRAFFIC_GAMMA_ALPHA * TRAFFIC_GAMMA_BETA)
        rep_bonus = reputation_uncertainty_bonus(rating, review_count)
        rep_mean = 1.0 + rep_bonus * 1.0

        expected_true = (prep_mean + wait_mean + travel_mean) * wt_mult * dist_factor * traffic_mean * rep_mean

        # Underestimate by eta_bias_factor, then add noise (platform variability)
        quoted = (expected_true / eta_bias_factor) * random.uniform(0.85, 1.20)
        eta_initial = int(_clamp(round(quoted), 10, 120))
        raw["eta_initial_minutes"] = int(eta_initial)

        was_late = bool(true_time > float(eta_initial))

        # Realistic label noise (human reporting error)
        if random.random() < 0.05:
            was_late = not was_late

        raw["was_late"] = bool(was_late)
        rows.append(raw)
    return rows


def compute_feature_stats(rows: Sequence[Dict[str, object]]) -> Dict[str, Dict[str, float]]:
    numeric_cols = [
        "hour_of_day",
        "day_of_week",
        "month",
        "precip_mm",
        "temp_celsius",
        "distance_km",
        "restaurant_rating",
        "restaurant_review_count",
        "restaurant_busy_score",
        "eta_initial_minutes",
        "eta_bias_factor",
    ]
    stats: Dict[str, Dict[str, float]] = {}
    for c in numeric_cols:
        xs = np.array([float(r[c]) for r in rows], dtype=np.float64)
        mu = float(xs.mean())
        sd = float(xs.std(ddof=0) + 1e-9)
        stats[c] = {"mean": mu, "std": sd}
    # Include is_peak as numeric for convenience
    peak = np.array([1.0 if bool(r["is_peak"]) else 0.0 for r in rows], dtype=np.float64)
    stats["is_peak"] = {"mean": float(peak.mean()), "std": float(peak.std(ddof=0) + 1e-9)}
    return stats


def write_csv(rows: Sequence[Dict[str, object]], path: Path) -> None:
    fieldnames = [
        "hour_of_day",
        "day_of_week",
        "month",
        "is_peak",
        "precip_mm",
        "temp_celsius",
        "distance_km",
        "restaurant_rating",
        "restaurant_review_count",
        "restaurant_busy_score",
        "eta_initial_minutes",
        "eta_bias_factor",
        "was_late",
    ]
    with path.open("w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=fieldnames)
        w.writeheader()
        for r in rows:
            w.writerow({k: r[k] for k in fieldnames})


def estimate_late_rate(rows: Sequence[Dict[str, object]]) -> float:
    if not rows:
        return 0.0
    y = np.array([1.0 if bool(r["was_late"]) else 0.0 for r in rows], dtype=np.float64)
    return float(y.mean())


def calibrate_baseline_multiplier(
    weather_obs: Sequence[WeatherObs],
    busy_by_restaurant_and_hour: Dict[str, Dict[int, float]],
    target: float = GLOBAL_BASE_LATE_RATE,
) -> float:
    # Binary search baseline multiplier to hit global late rate target.
    lo, hi = 0.55, 1.65
    for _ in range(14):
        mid = (lo + hi) / 2.0
        pilot = generate_rows(weather_obs, busy_by_restaurant_and_hour, n=6000, baseline_true_time_mult=mid)
        rate = estimate_late_rate(pilot)
        if rate > target:
            hi = mid
        else:
            lo = mid
    return (lo + hi) / 2.0


def main() -> None:
    random.seed(42)
    np.random.seed(42)

    weather_obs = fetch_waterloo_weather_hourly_last_365_days()
    busy = fetch_waterloo_restaurant_busy_scores_by_hour()

    baseline_mult = calibrate_baseline_multiplier(weather_obs, busy, target=GLOBAL_BASE_LATE_RATE)
    rows = generate_rows(weather_obs, busy, n=50_000, baseline_true_time_mult=baseline_mult)

    write_csv(rows, OUT_CSV)
    stats = compute_feature_stats(rows)

    payload = {
        "generated_at": datetime.now(tz=UTC).isoformat(),
        "n_rows": len(rows),
        "global_late_rate": estimate_late_rate(rows),
        "baseline_true_time_multiplier": baseline_mult,
        "feature_stats": stats,
        "schema": {
            "hour_of_day": "int",
            "day_of_week": "int",
            "month": "int",
            "is_peak": "bool",
            "precip_mm": "float",
            "temp_celsius": "float",
            "distance_km": "float",
            "restaurant_rating": "float",
            "restaurant_review_count": "int",
            "restaurant_busy_score": "float",
            "eta_initial_minutes": "int",
            "eta_bias_factor": "float",
            "was_late": "bool",
        },
    }
    OUT_STATS.write_text(json.dumps(payload, indent=2), encoding="utf-8")

    print(f"Wrote {OUT_CSV} ({len(rows)} rows)")
    print(f"Wrote {OUT_STATS}")
    print(f"Late rate: {payload['global_late_rate']:.3f} (target {GLOBAL_BASE_LATE_RATE:.2f})")
    print(f"Busy source: {json.loads(OUT_BUSY_CACHE.read_text(encoding='utf-8')).get('source')}")


if __name__ == "__main__":
    main()

