from sklearn.ensemble import RandomForestRegressor, RandomForestClassifier
from sklearn.metrics import (
    r2_score, mean_squared_error, mean_absolute_error,
    accuracy_score, roc_auc_score, log_loss,
    confusion_matrix, classification_report, brier_score_loss,
)
from fastapi.responses import JSONResponse
from sklearn.model_selection import train_test_split
import numpy as np
import pandas as pd

from controller.crossSectional.helpers import prepare_dataset


def _run_continuous(X_train, X_test, y_train, y_test):
    """Original Random Forest regression path — unchanged."""
    model = RandomForestRegressor(
        n_estimators=200,
        random_state=42,
        n_jobs=-1,
    )
    model.fit(X_train, y_train)
    predictions = model.predict(X_test)

    # ── Feature importances ──
    importances = {
        str(k): round(float(v), 6)
        for k, v in zip(X_train.columns, model.feature_importances_)
    }
    ranked = sorted(importances.items(), key=lambda x: x[1], reverse=True)

    return {
        "model":        "RANDOM_FOREST",
        "target_type":  "continuous",
        "r2_score":     round(float(r2_score(y_test, predictions)), 4),
        "mse":          round(float(mean_squared_error(y_test, predictions)), 4),
        "mae":          round(float(mean_absolute_error(y_test, predictions)), 4),
        "feature_importance":        importances,
        "feature_importances_ranked": [{"variable": k, "importance": v} for k, v in ranked],
    }


def _run_binary(X_train, X_test, y_train, y_test, threshold=0.5):
    """
    Random Forest classifier for binary (0/1) targets.
    Uses RandomForestClassifier instead of RandomForestRegressor.
    No scaling needed — tree models are scale-invariant.
    """
    model = RandomForestClassifier(
        n_estimators=200,
        random_state=42,
        n_jobs=-1,
    )
    model.fit(X_train, y_train)

    y_prob    = model.predict_proba(X_test)[:, 1]
    y_pred    = (y_prob >= threshold).astype(int)

    # ── Feature importances ──
    importances = {
        str(k): round(float(v), 6)
        for k, v in zip(X_train.columns, model.feature_importances_)
    }
    ranked = sorted(importances.items(), key=lambda x: x[1], reverse=True)

    # ── Std of importances across trees (stability measure) ──
    tree_importances = np.array([t.feature_importances_ for t in model.estimators_])
    importance_std = {
        str(k): round(float(v), 6)
        for k, v in zip(X_train.columns, tree_importances.std(axis=0))
    }

    return {
        "model":        "RANDOM_FOREST_CLASSIFIER",
        "target_type":  "binary",
        "threshold":    threshold,
        # ── Classification metrics ──
        "accuracy":     round(float(accuracy_score(y_test, y_pred)), 4),
        "roc_auc":      round(float(roc_auc_score(y_test, y_prob)), 4),
        "log_loss":     round(float(log_loss(y_test, y_prob)), 4),
        "brier_score":  round(float(brier_score_loss(y_test, y_prob)), 4),
        "confusion_matrix":      confusion_matrix(y_test, y_pred).tolist(),
        "classification_report": classification_report(y_test, y_pred, output_dict=True),
        # ── Feature importances ──
        "feature_importance":        importances,
        "feature_importances_std":    importance_std,
        "feature_importances_ranked": [{"variable": k, "importance": v} for k, v in ranked],
    }


async def run_random_forest_cross_sectional_prediction(request):
    try:
        payload = await request.json()

        raw_data         = payload.get("data", [])
        categorical_cols = payload.get("categorical_variable", [])
        dependent_col    = payload.get("dependent_variable")
        independent_cols = payload.get("independent_variable", [])
        id_col           = payload.get("id_column")
        remove_outliers  = payload.get("outliers", False)
        threshold        = float(payload.get("threshold", 0.5))

        if not raw_data:
            raise ValueError("No data provided")
        if not dependent_col:
            raise ValueError("Dependent variable is required")
        if not independent_cols:
            raise ValueError("Independent variables are required")

        prepared = prepare_dataset(
            raw_data=raw_data,
            dependent_col=dependent_col,
            independent_cols=independent_cols,
            categorical_cols=categorical_cols,
            id_col=id_col,
            remove_outliers=remove_outliers,
        )

        X = prepared["X"].copy().apply(pd.to_numeric, errors="coerce")
        y = pd.to_numeric(prepared["y"].copy(), errors="coerce")

        valid_rows = X.notna().all(axis=1) & y.notna()
        X, y = X[valid_rows], y[valid_rows]

        if len(X) < 5:
            raise ValueError("Dataset too small for Random Forest")

        # ── Auto-detect binary vs continuous ──
        is_binary = set(y.unique()).issubset({0, 1})

        # ── Train / test split ──
        X_train, X_test, y_train, y_test = train_test_split(
            X, y, test_size=0.2, random_state=42,
            stratify=y if is_binary else None,
        )

        # ── Branch on target type ──
        if is_binary:
            metrics = _run_binary(X_train, X_test, y_train, y_test, threshold)
        else:
            metrics = _run_continuous(X_train, X_test, y_train, y_test)

        return JSONResponse(content={
            "success":   True,
            "rows_used": len(X),
            **metrics,
        })

    except Exception as e:
        return JSONResponse(
            content={"success": False, "error": str(e)},
            status_code=500,
        )