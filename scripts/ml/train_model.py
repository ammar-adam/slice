import json
import math
import os
import pickle
from datetime import UTC, datetime
from pathlib import Path
from typing import Dict, List, Tuple

import joblib
import matplotlib.pyplot as plt
import numpy as np
import optuna
import pandas as pd
import shap
from sklearn.calibration import calibration_curve
from sklearn.metrics import brier_score_loss, roc_auc_score
from sklearn.model_selection import train_test_split
from xgboost import XGBClassifier


ROOT = Path(__file__).resolve().parent
DATA_DIR = ROOT / "data"
MODEL_DIR = ROOT / "model"
MODEL_DIR.mkdir(parents=True, exist_ok=True)

TRAINING_CSV = DATA_DIR / "training_data.csv"


def engineer_features(df: pd.DataFrame) -> pd.DataFrame:
    hour = df["hour_of_day"].astype(float)
    dow = df["day_of_week"].astype(float)

    out = df.copy()
    out["hour_sin"] = np.sin(2 * np.pi * hour / 24.0)
    out["hour_cos"] = np.cos(2 * np.pi * hour / 24.0)
    out["dow_sin"] = np.sin(2 * np.pi * dow / 7.0)
    out["dow_cos"] = np.cos(2 * np.pi * dow / 7.0)

    out["peak_rain"] = out["is_peak"].astype(float) * out["precip_mm"].astype(float)
    out["distance_peak"] = out["distance_km"].astype(float) * out["is_peak"].astype(float)

    out["rating_reviews_log"] = out["restaurant_rating"].astype(float) * np.log1p(
        out["restaurant_review_count"].astype(float)
    )

    out["eta_suspicion"] = (
        out["eta_initial_minutes"].astype(float) * out["restaurant_busy_score"].astype(float) / 100.0
    )

    return out


def temporal_split(df: pd.DataFrame, test_frac: float = 0.15) -> Tuple[pd.DataFrame, pd.DataFrame]:
    # Our dataset is written in temporal order (based on weather history timestamps).
    n = len(df)
    cut = int(math.floor(n * (1.0 - test_frac)))
    train_val = df.iloc[:cut].reset_index(drop=True)
    test = df.iloc[cut:].reset_index(drop=True)
    return train_val, test


def compute_feature_stats(df: pd.DataFrame, feature_names: List[str]) -> Dict[str, Dict[str, float]]:
    stats: Dict[str, Dict[str, float]] = {}
    for f in feature_names:
        x = df[f].astype(float).to_numpy()
        mu = float(np.mean(x))
        sd = float(np.std(x) + 1e-9)
        stats[f] = {"mean": mu, "std": sd}
    return stats


def _sigmoid(z: np.ndarray) -> np.ndarray:
    # numerically stable sigmoid
    z = np.clip(z, -60, 60)
    return 1.0 / (1.0 + np.exp(-z))


def _logit(p: np.ndarray) -> np.ndarray:
    p = np.clip(p, 1e-6, 1.0 - 1e-6)
    return np.log(p / (1.0 - p))


class PlattCalibrator:
    """
    Platt scaling: fit a sigmoid on model log-odds.
    posterior = sigmoid(a * logit(p_raw) + b)
    """

    def __init__(self, a: float, b: float):
        self.a = float(a)
        self.b = float(b)

    def predict_proba_from_raw_prob(self, raw_prob: np.ndarray) -> np.ndarray:
        x = _logit(raw_prob.astype(np.float64))
        p1 = _sigmoid(self.a * x + self.b)
        p0 = 1.0 - p1
        return np.stack([p0, p1], axis=1)

    def predict_proba(self, X: np.ndarray, model: XGBClassifier) -> np.ndarray:
        raw = model.predict_proba(X)[:, 1]
        return self.predict_proba_from_raw_prob(raw)


def fit_platt_scaler_from_validation(
    raw_prob_val: np.ndarray,
    y_val: np.ndarray,
) -> PlattCalibrator:
    # Fit a, b by logistic regression on logit(p_raw).
    # Optimize negative log-likelihood with simple gradient steps (stable + dependency-free).
    x = _logit(raw_prob_val.astype(np.float64))
    y = y_val.astype(np.float64)

    a = 1.0
    b = 0.0
    lr = 0.05
    for _ in range(2500):
        z = a * x + b
        p = _sigmoid(z)
        # gradients
        da = np.mean((p - y) * x)
        db = np.mean(p - y)
        a -= lr * da
        b -= lr * db
        # light damping if diverging
        if not (math.isfinite(a) and math.isfinite(b)):
            a, b = 1.0, 0.0
            lr *= 0.5
    return PlattCalibrator(a=a, b=b)


def main() -> None:
    if not TRAINING_CSV.exists():
        raise FileNotFoundError(f"Missing dataset at {TRAINING_CSV}. Run build_dataset.py first.")

    df_raw = pd.read_csv(TRAINING_CSV)
    if "was_late" not in df_raw.columns:
        raise RuntimeError("Dataset missing target column 'was_late'.")

    df = engineer_features(df_raw)

    y = df["was_late"].astype(int).to_numpy()

    feature_cols = [
        # cyclical encodings
        "hour_sin",
        "hour_cos",
        "dow_sin",
        "dow_cos",
        # raw operational features
        "is_peak",
        "precip_mm",
        "temp_celsius",
        "distance_km",
        "restaurant_rating",
        "restaurant_review_count",
        "restaurant_busy_score",
        "eta_initial_minutes",
        # interaction / engineered
        "peak_rain",
        "distance_peak",
        "rating_reviews_log",
        "eta_suspicion",
    ]

    # Ensure consistent column dtypes
    X_all = df[feature_cols].copy()
    X_all["is_peak"] = X_all["is_peak"].astype(int)

    train_val_df, test_df = temporal_split(pd.concat([X_all, pd.Series(y, name="y")], axis=1), test_frac=0.15)
    X_train_val = train_val_df[feature_cols].to_numpy(dtype=np.float32)
    y_train_val = train_val_df["y"].to_numpy(dtype=int)
    X_test = test_df[feature_cols].to_numpy(dtype=np.float32)
    y_test = test_df["y"].to_numpy(dtype=int)

    X_train, X_val, y_train, y_val = train_test_split(
        X_train_val,
        y_train_val,
        test_size=0.15,
        stratify=y_train_val,
        random_state=42,
    )

    scale_pos_weight = float((y_train == 0).sum() / max(1, (y_train == 1).sum()))

    def objective(trial: optuna.Trial) -> float:
        params = {
            "n_estimators": trial.suggest_int("n_estimators", 100, 500),
            "max_depth": trial.suggest_int("max_depth", 3, 7),
            "learning_rate": trial.suggest_float("lr", 0.01, 0.3, log=True),
            "subsample": trial.suggest_float("subsample", 0.6, 1.0),
            "colsample_bytree": trial.suggest_float("colsample", 0.6, 1.0),
            "min_child_weight": trial.suggest_int("min_child", 1, 10),
            "gamma": trial.suggest_float("gamma", 0.0, 5.0),
            "reg_alpha": trial.suggest_float("alpha", 1e-8, 10.0, log=True),
            "reg_lambda": trial.suggest_float("lambda", 1e-8, 10.0, log=True),
            "scale_pos_weight": scale_pos_weight,
            "eval_metric": "auc",
            "random_state": 42,
            "n_jobs": max(1, os.cpu_count() or 1),
            "tree_method": "hist",
            "early_stopping_rounds": 20,
        }

        model = XGBClassifier(**params)
        model.fit(
            X_train,
            y_train,
            eval_set=[(X_val, y_val)],
            verbose=False,
        )
        p = model.predict_proba(X_val)[:, 1]
        return float(roc_auc_score(y_val, p))

    sampler = optuna.samplers.TPESampler(seed=42)
    study = optuna.create_study(direction="maximize", sampler=sampler)
    study.optimize(objective, n_trials=100, show_progress_bar=True)

    best_params = study.best_trial.params
    best_xgb = XGBClassifier(
        n_estimators=int(best_params["n_estimators"]),
        max_depth=int(best_params["max_depth"]),
        learning_rate=float(best_params["lr"]),
        subsample=float(best_params["subsample"]),
        colsample_bytree=float(best_params["colsample"]),
        min_child_weight=int(best_params["min_child"]),
        gamma=float(best_params["gamma"]),
        reg_alpha=float(best_params["alpha"]),
        reg_lambda=float(best_params["lambda"]),
        scale_pos_weight=scale_pos_weight,
        eval_metric="auc",
        random_state=42,
        n_jobs=max(1, os.cpu_count() or 1),
        tree_method="hist",
        early_stopping_rounds=20,
    )

    best_xgb.fit(
        X_train,
        y_train,
        eval_set=[(X_val, y_val)],
        verbose=False,
    )

    raw_val_prob = best_xgb.predict_proba(X_val)[:, 1]
    calibrator = fit_platt_scaler_from_validation(raw_val_prob, y_val)

    raw_test_prob = best_xgb.predict_proba(X_test)[:, 1]
    cal_test_prob = calibrator.predict_proba_from_raw_prob(raw_test_prob)[:, 1]

    roc = float(roc_auc_score(y_test, cal_test_prob))
    brier = float(brier_score_loss(y_test, cal_test_prob))

    frac_pos, mean_pred = calibration_curve(y_test, cal_test_prob, n_bins=10, strategy="quantile")
    plt.figure(figsize=(6.0, 6.0))
    plt.plot(mean_pred, frac_pos, marker="o", label="Calibrated (sigmoid)")
    plt.plot([0, 1], [0, 1], "--", color="gray", label="Ideal")
    plt.xlabel("Predicted probability")
    plt.ylabel("Observed frequency")
    plt.title("Calibration curve (test)")
    plt.legend(loc="best")
    calib_png = MODEL_DIR / "calibration_curve_v1.png"
    plt.tight_layout()
    plt.savefig(calib_png, dpi=160)
    plt.close()

    # Feature importances (gain)
    booster = best_xgb.get_booster()
    score = booster.get_score(importance_type="gain")
    importances = []
    for i, name in enumerate(feature_cols):
        importances.append({"feature": name, "gain": float(score.get(f"f{i}", 0.0))})
    importances = sorted(importances, key=lambda x: x["gain"], reverse=True)

    # SHAP (top 5 by mean |value|), sampled for speed
    rng = np.random.default_rng(42)
    idx = rng.choice(len(X_test), size=min(1500, len(X_test)), replace=False)
    X_shap = X_test[idx]
    explainer = shap.TreeExplainer(best_xgb)
    shap_vals = explainer.shap_values(X_shap)
    shap_abs = np.mean(np.abs(shap_vals), axis=0)
    shap_rank = sorted(
        [{"feature": feature_cols[i], "mean_abs_shap": float(shap_abs[i])} for i in range(len(feature_cols))],
        key=lambda x: x["mean_abs_shap"],
        reverse=True,
    )

    eval_report = {
        "generated_at": datetime.now(tz=UTC).isoformat(),
        "model_version": "xgb_v1",
        "n_rows": int(len(df)),
        "n_train": int(len(X_train)),
        "n_val": int(len(X_val)),
        "n_test": int(len(X_test)),
        "roc_auc_test": roc,
        "brier_score_test": brier,
        "calibration_curve": {
            "mean_predicted_value": [float(x) for x in mean_pred],
            "fraction_of_positives": [float(x) for x in frac_pos],
        },
        "raw_model_prob_summary_test": {
            "mean": float(np.mean(raw_test_prob)),
            "p50": float(np.quantile(raw_test_prob, 0.5)),
            "p90": float(np.quantile(raw_test_prob, 0.9)),
        },
        "calibrated_prob_summary_test": {
            "mean": float(np.mean(cal_test_prob)),
            "p50": float(np.quantile(cal_test_prob, 0.5)),
            "p90": float(np.quantile(cal_test_prob, 0.9)),
        },
        "feature_importances_gain": importances[:20],
        "shap_top5": shap_rank[:5],
        "optuna": {
            "n_trials": 100,
            "best_value_auc": float(study.best_value),
            "best_params": {k: (float(v) if isinstance(v, (int, float)) else v) for k, v in best_params.items()},
        },
        "artifacts": {
            "calibration_curve_png": str(calib_png.name),
        },
    }

    # Save artifacts
    xgb_path = MODEL_DIR / "xgb_v1.json"
    best_xgb.save_model(xgb_path)

    cal_path = MODEL_DIR / "calibrator_v1.pkl"
    with cal_path.open("wb") as f:
        pickle.dump(calibrator, f)

    feature_names_path = MODEL_DIR / "feature_names.json"
    feature_names_path.write_text(json.dumps(feature_cols, indent=2), encoding="utf-8")

    feature_stats = compute_feature_stats(pd.DataFrame(X_all, columns=feature_cols), feature_cols)
    (MODEL_DIR / "feature_stats.json").write_text(json.dumps(feature_stats, indent=2), encoding="utf-8")

    (MODEL_DIR / "eval_report.json").write_text(json.dumps(eval_report, indent=2), encoding="utf-8")

    # Convenience: also dump calibrator with joblib for faster loads if desired
    joblib.dump(calibrator, MODEL_DIR / "calibrator_v1.joblib")

    print(f"Saved model: {xgb_path}")
    print(f"Saved calibrator: {cal_path}")
    print(f"Saved feature_names: {feature_names_path}")
    print(f"Saved eval_report: {MODEL_DIR / 'eval_report.json'}")
    print(f"ROC-AUC (test): {roc:.3f}")
    print(f"Brier (test): {brier:.3f}")


if __name__ == "__main__":
    main()

