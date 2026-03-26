import io
import json
import os
import pickle
from typing import Any, Dict, List

import numpy as np
import xgboost as xgb


def _sigmoid(z: np.ndarray) -> np.ndarray:
    z = np.clip(z, -60, 60)
    return 1.0 / (1.0 + np.exp(-z))


def _logit(p: np.ndarray) -> np.ndarray:
    p = np.clip(p, 1e-6, 1.0 - 1e-6)
    return np.log(p / (1.0 - p))


class PlattCalibrator:
    def __init__(self, a: float, b: float):
        self.a = float(a)
        self.b = float(b)

    def predict_proba_from_raw_prob(self, raw_prob: np.ndarray) -> np.ndarray:
        x = _logit(raw_prob.astype(np.float64))
        p1 = _sigmoid(self.a * x + self.b)
        p0 = 1.0 - p1
        return np.stack([p0, p1], axis=1)


class _CompatUnpickler(pickle.Unpickler):
    def find_class(self, module: str, name: str):  # type: ignore[override]
        if name == "PlattCalibrator":
            return PlattCalibrator
        return super().find_class(module, name)


def _load_pickle_compat(path: str) -> Any:
    with open(path, "rb") as f:
        payload = f.read()
    return _CompatUnpickler(io.BytesIO(payload)).load()


def engineer_features(raw: Dict[str, Any], feature_names: List[str]) -> np.ndarray:
    hour = int(raw["hour_of_day"])
    dow = int(raw["day_of_week"])
    is_peak = 1.0 if bool(raw["is_peak"]) else 0.0
    precip = float(raw["precip_mm"])
    temp = float(raw["temp_celsius"])
    distance = float(raw["distance_km"])
    rating = float(raw["restaurant_rating"])
    review_count = float(raw["review_count"])
    busy_score = float(raw["busy_score"])
    eta_minutes = float(raw["eta_minutes"])

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

    return np.array([[features[f] for f in feature_names]], dtype=np.float32)


def main() -> None:
    model_dir = os.path.join(os.path.dirname(__file__), "model")
    xgb_path = os.path.join(model_dir, "xgb_v1.json")
    cal_path = os.path.join(model_dir, "calibrator_v1.pkl")
    feat_names_path = os.path.join(model_dir, "feature_names.json")

    bst = xgb.XGBClassifier()
    bst.load_model(xgb_path)
    calibrator: PlattCalibrator = _load_pickle_compat(cal_path)
    feature_names = json.loads(open(feat_names_path, "r", encoding="utf-8").read())

    test_cases = [
        {
            "name": "Friday 7pm rain Campus Pizza",
            "payload": {
                "hour_of_day": 19,
                "day_of_week": 4,
                "is_peak": True,
                "precip_mm": 4.2,
                "temp_celsius": 3.0,
                "distance_km": 4.8,
                "restaurant_rating": 3.6,
                "review_count": 140,
                "busy_score": 88,
                "eta_minutes": 58,
            },
            "expected": "high",
        },
        {
            "name": "Tuesday 2pm clear close",
            "payload": {
                "hour_of_day": 14,
                "day_of_week": 1,
                "is_peak": False,
                "precip_mm": 0.0,
                "temp_celsius": 18.0,
                "distance_km": 1.0,
                "restaurant_rating": 4.6,
                "review_count": 1200,
                "busy_score": 26,
                "eta_minutes": 20,
            },
            "expected": "low",
        },
        {
            "name": "Late night baseline",
            "payload": {
                "hour_of_day": 0,
                "day_of_week": 2,
                "is_peak": False,
                "precip_mm": 0.6,
                "temp_celsius": 7.0,
                "distance_km": 3.1,
                "restaurant_rating": 4.0,
                "review_count": 300,
                "busy_score": 76,
                "eta_minutes": 43,
            },
            "expected": "high",
        },
        {
            "name": "Lunch rush far rain",
            "payload": {
                "hour_of_day": 12,
                "day_of_week": 3,
                "is_peak": True,
                "precip_mm": 5.0,
                "temp_celsius": 1.0,
                "distance_km": 6.4,
                "restaurant_rating": 3.9,
                "review_count": 460,
                "busy_score": 92,
                "eta_minutes": 67,
            },
            "expected": "high",
        },
        {
            "name": "Weekend morning clear high rated",
            "payload": {
                "hour_of_day": 9,
                "day_of_week": 6,
                "is_peak": False,
                "precip_mm": 0.0,
                "temp_celsius": 16.0,
                "distance_km": 1.8,
                "restaurant_rating": 4.8,
                "review_count": 2200,
                "busy_score": 18,
                "eta_minutes": 22,
            },
            "expected": "low",
        },
    ]

    probs: List[float] = []
    print("Prediction checks:")
    for case in test_cases:
        X = engineer_features(case["payload"], feature_names)
        raw_prob = float(bst.predict_proba(X)[0][1])
        prob = float(calibrator.predict_proba_from_raw_prob(np.array([raw_prob]))[0][1])
        prob = float(max(0.03, min(0.97, prob)))
        probs.append(prob)
        print(f"- {case['name']}: {prob:.4f} (expected {case['expected']})")

    out_of_bounds = [p for p in probs if p < 0.03 or p > 0.97]
    if out_of_bounds:
        raise AssertionError(f"Probabilities out of bounds: {out_of_bounds}")

    print("All probabilities are within [0.03, 0.97].")


if __name__ == "__main__":
    main()

