from sklearn.ensemble import BaggingRegressor, BaggingClassifier
from sklearn.tree import DecisionTreeRegressor, DecisionTreeClassifier
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
    """Original Bagging regression path — unchanged."""
    base_model = DecisionTreeRegressor(random_state=42)
    model = BaggingRegressor(
        estimator=base_model, n_estimators=100, random_state=42
    )
    model.fit(X_train, y_train)
    predictions = model.predict(X_test)

    importances = np.mean(
        [tree.feature_importances_ for tree in model.estimators_], axis=0
    )
    importance_std = np.std(
        [tree.feature_importances_ for tree in model.estimators_], axis=0
    )
    feature_importances = {
        str(k): round(float(v), 6) for k, v in zip(X_train.columns, importances)
    }
    feature_importances_std = {
        str(k): round(float(v), 6) for k, v in zip(X_train.columns, importance_std)
    }
    ranked = sorted(feature_importances.items(), key=lambda x: x[1], reverse=True)

    return {
        "model":        "BAGGING",
        "target_type":  "continuous",
        "r2_score":     round(float(r2_score(y_test, predictions)), 4),
        "mse":          round(float(mean_squared_error(y_test, predictions)), 4),
        "mae":          round(float(mean_absolute_error(y_test, predictions)), 4),
        "feature_importances":        feature_importances,
        "feature_importances_std":    feature_importances_std,
        "feature_importances_ranked": [{"variable": k, "importance": v} for k, v in ranked],
        # Keep old key for backward compatibility with existing frontend
        "feature_importance": feature_importances,
    }


def _run_binary(X_train, X_test, y_train, y_test, threshold=0.5):
    """
    Bagging classifier for binary (0/1) targets.
    Uses BaggingClassifier with DecisionTreeClassifier as the base estimator.
    No scaling needed — tree models are scale-invariant.
    """
    base_model = DecisionTreeClassifier(random_state=42)
    model = BaggingClassifier(
        estimator=base_model, n_estimators=100, random_state=42, n_jobs=-1,
    )
    model.fit(X_train, y_train)

    y_prob = model.predict_proba(X_test)[:, 1]
    y_pred = (y_prob >= threshold).astype(int)

    # Aggregate feature importances across all base trees
    importances = np.mean(
        [tree.feature_importances_ for tree in model.estimators_], axis=0
    )
    importance_std = np.std(
        [tree.feature_importances_ for tree in model.estimators_], axis=0
    )
    feature_importances = {
        str(k): round(float(v), 6) for k, v in zip(X_train.columns, importances)
    }
    feature_importances_std = {
        str(k): round(float(v), 6) for k, v in zip(X_train.columns, importance_std)
    }
    ranked = sorted(feature_importances.items(), key=lambda x: x[1], reverse=True)

    return {
        "model":        "BAGGING_CLASSIFIER",
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
        "feature_importances":        feature_importances,
        "feature_importances_std":    feature_importances_std,
        "feature_importances_ranked": [{"variable": k, "importance": v} for k, v in ranked],
        "feature_importance": feature_importances,
    }


async def run_bagging_cross_sectional_prediction(request):
    try:
        payload = await request.json()

        raw_data         = payload.get("data", [])
        categorical_cols = payload.get("categorical_variable", [])
        dependent_col    = payload.get("dependent_variable")
        independent_cols = payload.get("independent_variable", [])
        id_col           = payload.get("id_column")
        remove_outliers  = payload.get("outliers", False)
        threshold        = float(payload.get("threshold", 0.5))

        prepared = prepare_dataset(
            raw_data,
            dependent_col,
            independent_cols,
            categorical_cols,
            id_col,
            remove_outliers,
        )

        X = prepared["X"].copy().apply(pd.to_numeric, errors="coerce")
        y = pd.to_numeric(prepared["y"].copy(), errors="coerce")

        valid_rows = X.notna().all(axis=1) & y.notna()
        X, y = X[valid_rows], y[valid_rows]

        if len(X) < 5:
            raise ValueError("Dataset too small for Bagging")

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