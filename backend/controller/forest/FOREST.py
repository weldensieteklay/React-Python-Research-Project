from fastapi import Request, HTTPException
import pandas as pd
import numpy as np
from sklearn.ensemble import RandomForestRegressor
from sklearn.model_selection import TimeSeriesSplit

from ..common.helper import (
    clean_input_data,
    preprocess_exog,
    compute_rf_metrics,
    to_serializable,
    create_lag_features
)


def _fit_rf(X_train, y_train, n_estimators, max_depth, min_samples_leaf, min_samples_split):
    """
    Regularized Random Forest. max_depth=None + min_samples_leaf=1
    (the original defaults) let every tree grow until each leaf is a
    single point -- with only a handful of lag/exog features, that
    memorizes training noise instead of learning a stable pattern.
    Bounding depth and requiring more samples per leaf/split trades a
    bit of training fit for a model that generalizes to new time
    periods, which is the point of a forecasting model.
    """
    model = RandomForestRegressor(
        n_estimators=n_estimators,
        max_depth=max_depth,
        min_samples_split=min_samples_split,
        min_samples_leaf=min_samples_leaf,
        max_features="sqrt",
        random_state=42,
        n_jobs=-1,
    )
    model.fit(X_train, y_train)
    return model


def _aggregate_fold_metrics(fold_metrics):
    """Mean/std across folds for scalar accuracy metrics (rmse, mae, r2,
    n_estimators)."""
    if not fold_metrics:
        return None
    common_keys = set.intersection(*(set(m.keys()) for m in fold_metrics))
    agg = {}
    for key in sorted(common_keys):
        vals = [m[key] for m in fold_metrics if isinstance(m.get(key), (int, float))]
        if vals:
            agg[key] = {
                "mean": round(float(np.mean(vals)), 4),
                "std": round(float(np.std(vals)), 4),
            }
    return agg


# -------------------------
# FastAPI "Controller" function
# -------------------------
async def predict_price_random_forest(request: Request):
    try:
        payload = await request.json()

        raw_data = payload.get("data", [])
        date_col = payload.get("date_variable")
        target_col = payload.get("target_variable")
        exog_cols = payload.get("exogenous_variable", [])
        cv_folds = int(payload.get("cv_folds", 3))

        # Regularization knobs, tunable per request but sensibly
        # defaulted instead of the original's unbounded tree growth.
        n_estimators = int(payload.get("n_estimators", 200))
        max_depth = payload.get("max_depth", 8)
        min_samples_leaf = int(payload.get("min_samples_leaf", 5))
        min_samples_split = int(payload.get("min_samples_split", 10))

        if not raw_data or not date_col or not target_col:
            raise HTTPException(status_code=400, detail="Missing required fields")

        if cv_folds < 2:
            raise HTTPException(status_code=400, detail="cv_folds must be at least 2")

        # --------------------------
        # Load & clean data
        # --------------------------
        df = clean_input_data(raw_data)
        df[date_col] = pd.to_datetime(df[date_col])
        df[target_col] = pd.to_numeric(df[target_col], errors="coerce")
        df.sort_values(by=date_col, inplace=True)

        # --------------------------
        # Generate lag features
        # --------------------------
        df = create_lag_features(df, target_col, num_lags=3)
        lag_cols = [col for col in df.columns if col.startswith(f"{target_col}_lag_")]

        if not lag_cols and not exog_cols:
            raise HTTPException(status_code=400, detail="No features found for model")

        # --------------------------
        # Build feature matrix
        # --------------------------
        if exog_cols:
            exog_df = preprocess_exog(df, exog_cols)
            X = pd.concat([exog_df, df[lag_cols]], axis=1)
        else:
            X = df[lag_cols]

        valid_rows = X.dropna().index
        X = X.loc[valid_rows].reset_index(drop=True)
        y = df.loc[valid_rows, target_col].reset_index(drop=True)

        min_required = max(20, cv_folds * 8)
        if len(X) < min_required:
            raise HTTPException(
                status_code=400,
                detail=f"Not enough observations: need at least {min_required} "
                       f"for {cv_folds}-fold CV, got {len(X)}"
            )

        # --------------------------
        # Walk-forward outer cross-validation.
        # Each fold trains only on the past and tests on the block
        # right after it -- shuffled k-fold would leak future rows
        # (including lag features built from them) into training.
        # Fixed hyperparameters are reused across folds rather than
        # re-tuned per fold, keeping total cost to cv_folds + 1 fits.
        # --------------------------
        outer_cv = TimeSeriesSplit(n_splits=cv_folds)
        fold_metrics = []

        for train_idx, test_idx in outer_cv.split(X):
            X_tr, X_te = X.iloc[train_idx], X.iloc[test_idx]
            y_tr, y_te = y.iloc[train_idx], y.iloc[test_idx]

            try:
                fold_model = _fit_rf(
                    X_tr, y_tr, n_estimators, max_depth, min_samples_leaf, min_samples_split
                )
                fold_metrics.append(compute_rf_metrics(fold_model, X_te, y_te, X.columns))
            except Exception:
                continue

        cross_validation = {
            "folds_requested": cv_folds,
            "folds_used": len(fold_metrics),
            **(_aggregate_fold_metrics(fold_metrics) or {}),
        }

        # --------------------------
        # Final hold-out fit (last 80/20 split) -- the reportable model
        # --------------------------
        split_index = int(len(X) * 0.8)
        X_train, X_test = X.iloc[:split_index], X.iloc[split_index:]
        y_train, y_test = y.iloc[:split_index], y.iloc[split_index:]

        model = _fit_rf(
            X_train, y_train, n_estimators, max_depth, min_samples_leaf, min_samples_split
        )

        metrics = compute_rf_metrics(model, X_test, y_test, X.columns)

        response = {
            "model": "RANDOM_FOREST",
            "hyperparameters": {
                "n_estimators": n_estimators,
                "max_depth": max_depth,
                "min_samples_leaf": min_samples_leaf,
                "min_samples_split": min_samples_split,
            },
            "rows_used": int(len(X)),
            "cross_validation": cross_validation,
            **metrics,
        }
        return to_serializable(response)

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))