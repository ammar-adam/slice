import io
import json
import math
import os
import pickle
from typing import Any, Dict, List, Tuple

import numpy as np
import xgboost as xgb


def _sigmoid(z: np.ndarray) -> np.ndarray:
    z = np.clip(z, -60, 60)
    return 1.0 / (1.0 + np.exp(-z))


def _logit(p: np.ndarray) -> np.ndarray:
    p = np.clip(p, 1e-6, 1.0 - 1e-6)
    return np.log(p / (1.0 - p))


class PlattCalibrator:
    """
    Runtime representation matching the training-time calibrator contract.
    """

    def __init__(self, a: float, b: float):
        self.a = float(a)
        self.b = float(b)

    def predict_proba_from_raw_prob(self, raw_prob: np.ndarray) -> np.ndarray:
        x = _logit(raw_prob.astype(np.float64))
        p1 = _sigmoid(self.a * x + self.b)
        p0 = 1.0 - p1
        return np.stack([p0, p1], axis=1)

    def predict_proba(self, X: np.ndarray, model: xgb.XGBClassifier) -> np.ndarray:
        raw = model.predict_proba(X)[:, 1]
        return self.predict_proba_from_raw_prob(raw)


class _CompatUnpickler(pickle.Unpickler):
    """
    Handles calibrator pickles produced from script execution context (__main__).
    """

    def find_class(self, module: str, name: str):  # type: ignore[override]
        if name == "PlattCalibrator":
            return PlattCalibrator
        return super().find_class(module, name)


def _load_pickle_compat(path: str) -> Any:
    with open(path, "rb") as f:
        payload = f.read()
    return _CompatUnpickler(io.BytesIO(payload)).load()


BASE_DIR = os.path.dirname(__file__)
MODEL_DIR = os.path.abspath(os.path.join(BASE_DIR, "../../scripts/ml/model"))

XGB_PATH = os.path.join(MODEL_DIR, "xgb_v1.json")
CALIBRATOR_PATH = os.path.join(MODEL_DIR, "calibrator_v1.pkl")
FEATURE_NAMES_PATH = os.path.join(MODEL_DIR, "feature_names.json")
FEATURE_STATS_PATH = os.path.join(MODEL_DIR, "feature_stats.json")

_load_error: str | None = None
_bst: xgb.XGBClassifier | None = None
_calibrator: PlattCalibrator | None = None
_feature_names: List[str] = []
_feature_stats: Dict[str, Dict[str, float]] = {}

try:
    _bst = xgb.XGBClassifier()
    _bst.load_model(XGB_PATH)
    _calibrator = _load_pickle_compat(CALIBRATOR_PATH)
    with open(FEATURE_NAMES_PATH, "r", encoding="utf-8") as f:
        _feature_names = json.load(f)
    with open(FEATURE_STATS_PATH, "r", encoding="utf-8") as f:
        _feature_stats = json.load(f)
except Exception as e:
    _load_error = str(e)


def _bool_to_float(v: Any) -> float:
    return 1.0 if bool(v) else 0.0


def _as_float(body: Dict[str, Any], *keys: str, default: float | None = None) -> float:
    for k in keys:
        if k in body:
            return float(body[k])
    if default is not None:
        return float(default)
    raise KeyError(keys[0])


def engineer_features(raw: Dict[str, Any]) -> np.ndarray:
    hour = int(_as_float(raw, "hour_of_day"))
    dow = int(_as_float(raw, "day_of_week"))
    is_peak = _bool_to_float(raw.get("is_peak", False))
    precip = _as_float(raw, "precip_mm")
    temp = _as_float(raw, "temp_celsius")
    distance = _as_float(raw, "distance_km")
    rating = _as_float(raw, "restaurant_rating")
    review_count = _as_float(raw, "review_count", "restaurant_review_count")
    busy_score = _as_float(raw, "busy_score", "restaurant_busy_score")
    eta_minutes = _as_float(raw, "eta_minutes", "eta_initial_minutes")

    features = {
        "hour_sin": float(np.sin(2 * np.pi * hour / 24.0)),
        "hour_cos": float(np.cos(2 * np.pi * hour / 24.0)),
        "dow_sin": float(np.sin(2 * np.pi * dow / 7.0)),
        "dow_cos": float(np.cos(2 * np.pi * dow / 7.0)),
        "is_peak": is_peak,
        "precip_mm": precip,
        "temp_celsius": temp,
        "distance_km": distance,
        "restaurant_rating": rating,
        "restaurant_review_count": review_count,
        "restaurant_busy_score": busy_score,
        "eta_initial_minutes": eta_minutes,
        "peak_rain": is_peak * precip,
        "distance_peak": distance * is_peak,
        "rating_reviews_log": rating * float(np.log1p(review_count)),
        "eta_suspicion": eta_minutes * busy_score / 100.0,
    }

    if not _feature_names:
        raise RuntimeError("Feature names not loaded")
    return np.array([[features[f] for f in _feature_names]], dtype=np.float32)


def get_confidence_band(prob: float) -> str:
    if prob < 0.3:
        return "likely_on_time"
    if prob < 0.45:
        return "probably_on_time"
    if prob < 0.55:
        return "toss_up"
    if prob < 0.7:
        return "probably_late"
    return "likely_late"


def get_top_contributors(raw: Dict[str, Any]) -> List[str]:
    contributors: List[str] = []
    precip = float(raw.get("precip_mm", 0.0))
    is_peak = bool(raw.get("is_peak", False))
    distance = float(raw.get("distance_km", 0.0))
    rating = float(raw.get("restaurant_rating", 4.5))
    busy = float(raw.get("busy_score", raw.get("restaurant_busy_score", 0.0)))
    eta = float(raw.get("eta_minutes", raw.get("eta_initial_minutes", 0.0)))

    if precip > 2:
        contributors.append("Rain detected")
    if is_peak:
        contributors.append("Peak delivery hours")
    if distance > 3:
        contributors.append(f"{distance:.1f}km distance")
    if rating < 3.8:
        contributors.append("Low restaurant rating")
    if busy > 70:
        contributors.append("Restaurant very busy")
    if eta > 45:
        contributors.append("Long quoted ETA")

    return contributors[:3]


def weighted_fallback(body: Dict[str, Any]) -> float:
    # Lightweight fallback if model artifacts fail to load.
    precip = float(body.get("precip_mm", 0.0))
    is_peak = 1.0 if bool(body.get("is_peak", False)) else 0.0
    distance = float(body.get("distance_km", 0.0))
    rating = float(body.get("restaurant_rating", 4.2))
    busy = float(body.get("busy_score", body.get("restaurant_busy_score", 45.0)))
    eta = float(body.get("eta_minutes", body.get("eta_initial_minutes", 30.0)))

    score = (
        0.18
        + 0.08 * is_peak
        + 0.10 * min(1.0, precip / 6.0)
        + 0.12 * min(1.0, distance / 8.0)
        + 0.22 * min(1.0, busy / 100.0)
        + 0.08 * min(1.0, eta / 70.0)
        + 0.12 * max(0.0, (4.5 - rating) / 1.7)
    )
    return float(max(0.03, min(0.97, score)))


def _json_response(payload: Dict[str, Any], status: int = 200):
    return {
        "statusCode": status,
        "headers": {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "POST,OPTIONS",
            "Access-Control-Allow-Headers": "Content-Type",
        },
        "body": json.dumps(payload),
    }


def _extract_method_and_body(request: Any) -> Tuple[str, Dict[str, Any]]:
    method = getattr(request, "method", "POST")

    # Vercel Python runtime request body compatibility
    body_obj: Any = {}
    if hasattr(request, "json"):
        body_obj = request.json if not callable(request.json) else request.json()
    elif isinstance(request, dict):
        body_obj = request.get("body", {})

    if isinstance(body_obj, str):
        body = json.loads(body_obj)
    else:
        body = dict(body_obj or {})

    return method, body


def handler(request):
    method, body = _extract_method_and_body(request)
    if method == "OPTIONS":
        return _json_response({"ok": True}, status=200)

    required = [
        "hour_of_day",
        "day_of_week",
        "is_peak",
        "precip_mm",
        "temp_celsius",
        "distance_km",
        "restaurant_rating",
        "review_count",
        "busy_score",
        "eta_minutes",
    ]
    missing = [f for f in required if f not in body]
    if missing:
        return _json_response({"error": f"Missing fields: {missing}"}, status=400)

    try:
        if _load_error is not None or _bst is None or _calibrator is None:
            raise RuntimeError(_load_error or "Model not loaded")

        X = engineer_features(body)
        raw_prob = float(_bst.predict_proba(X)[0][1])
        prob = float(_calibrator.predict_proba_from_raw_prob(np.array([raw_prob], dtype=np.float64))[0][1])
        prob = float(max(0.03, min(0.97, prob)))

        return _json_response(
            {
                "delay_probability": round(prob, 4),
                "model_version": "xgb_v1",
                "confidence": get_confidence_band(prob),
                "top_factors": get_top_contributors(body),
                "raw_model_prob": round(raw_prob, 4),
            }
        )
    except Exception as e:
        fallback_prob = weighted_fallback(body)
        return _json_response(
            {
                "delay_probability": round(fallback_prob, 4),
                "model_version": "weighted_fallback",
                "error": str(e),
            }
        )

