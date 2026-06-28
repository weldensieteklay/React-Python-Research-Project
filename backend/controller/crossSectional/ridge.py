from sklearn.linear_model import Ridge, LogisticRegression
from sklearn.metrics import (
    r2_score, mean_squared_error, mean_absolute_error,
    accuracy_score, roc_auc_score, log_loss,
    confusion_matrix, classification_report, brier_score_loss,
)
from sklearn.preprocessing import StandardScaler
from fastapi.responses import JSONResponse
from sklearn.model_selection import train_test_split
import numpy as np
import pandas as pd

from controller.crossSectional.helpers import prepare_dataset


def _run_continuous(X_train, X_test, y_train, y_test):
    """Original Ridge path — unchanged."""
    model = Ridge(alpha=1.0)
    model.fit(X_train, y_train)
    predictions = model.predict(X_test)

    return {
        "model":       "RIDGE",
        "target_type": "continuous",
        "r2_score":    round(float(r2_score(y_test, predictions)), 4),
        "mse":         round(float(mean_squared_error(y_test, predictions)), 4),
        "mae":         round(float(mean_absolute_error(y_test, predictions)), 4),
        "coefficients": {
            str(k): round(float(v), 6)
            for k, v in zip(X_train.columns, model.coef_)
        },
        "standard_errors": {str(k): None for k in X_train.columns},
        "p_values":        {str(k): None for k in X_train.columns},
    }


def _run_binary(X_train, X_test, y_train, y_test, threshold=0.5):
    """
    Ridge logistic regression (L2 penalty) for binary (0/1) targets.
    Ridge shrinks all coefficients but never zeroes them out,
    unlike Lasso which performs variable selection.

    MSE and MAE are computed against predicted probabilities (not hard 0/1
    predictions) for API consistency with the continuous path.
    Note: brier_score is the statistically correct name for prob-vs-label MSE,
    and log_loss is the primary loss metric — use those as the main binary metrics.
    """
    scaler         = StandardScaler()
    X_train_scaled = scaler.fit_transform(X_train)
    X_test_scaled  = scaler.transform(X_test)

    model = LogisticRegression(
        penalty="l2",
        solver="lbfgs",
        C=1.0,
        max_iter=10000,
        random_state=42,
    )
    model.fit(X_train_scaled, y_train)

    y_prob    = model.predict_proba(X_test_scaled)[:, 1]
    y_pred    = (y_prob >= threshold).astype(int)
    coef_vals = model.coef_[0]

    return {
        "model":        "RIDGE_LOGISTIC",
        "target_type":  "binary",
        "threshold":    threshold,
        # ── Classification metrics ──
        "accuracy":     round(float(accuracy_score(y_test, y_pred)), 4),
        "roc_auc":      round(float(roc_auc_score(y_test, y_prob)), 4),
        "log_loss":     round(float(log_loss(y_test, y_prob)), 4),
        "brier_score":  round(float(brier_score_loss(y_test, y_prob)), 4),
        # ── MSE/MAE on predicted probabilities vs true labels ──
        # Included for API consistency with the continuous path.
        # brier_score above is the statistically correct equivalent of MSE for binary.
        "mse":          round(float(mean_squared_error(y_test, y_prob)), 4),
        "mae":          round(float(mean_absolute_error(y_test, y_prob)), 4),
        "confusion_matrix":      confusion_matrix(y_test, y_pred).tolist(),
        "classification_report": classification_report(y_test, y_pred, output_dict=True),
        "coefficients": {
            str(k): round(float(v), 6)
            for k, v in zip(X_train.columns, coef_vals)
        },
        "odds_ratios": {
            str(k): round(float(np.exp(v)), 6)
            for k, v in zip(X_train.columns, coef_vals)
        },
        "standard_errors": {str(k): None for k in X_train.columns},
        "p_values":        {str(k): None for k in X_train.columns},
    }


async def run_ridge_cross_sectional_prediction(request):
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
            raise ValueError("Dataset too small for Ridge regression")

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
            content={
                "success": False,
                "error":   "Model execution failed",
                "details": str(e),
            },
            status_code=500,
        )