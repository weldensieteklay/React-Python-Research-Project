from fastapi import Request, HTTPException
import pandas as pd
import numpy as np
from sklearn.ensemble import BaggingRegressor
from sklearn.tree import DecisionTreeRegressor
from sklearn.model_selection import TimeSeriesSplit

from ..common.helper import (
    clean_input_data,
    preprocess_exog,
    create_lag_features,
    compute_bagging_metrics,
    to_serializable
)


def _fit_bagging(X_train, y_train, n_estimators, max_depth, min_samples_leaf,
                  max_samples, max_features):
    """
    Bagging with a regularized base tree and actual sample/feature
    diversity between estimators.

    The original used an unconstrained DecisionTreeRegressor (default
    max_depth=None, min_samples_leaf=1) as the base estimator -- same
    overfitting risk as an unregularized Random Forest. It also used
    max_samples=1.0 and max_features=1.0, meaning every tree trained
    on (a bootstrap of) the full dataset with every feature -- bagging's
    variance-reduction benefit comes specifically from decorrelating
    the trees, which requires each one to see a different subset of
    rows and/or columns.
    """
    base_estimator = DecisionTreeRegressor(
        max_depth=max_depth,
        min_samples_leaf=min_samples_leaf,
    )
    model = BaggingRegressor(
        estimator=base_estimator,
        n_estimators=n_estimators,
        max_samples=max_samples,
        max_features=max_features,
        bootstrap=True,
        random_state=42,
        n_jobs=-1,
    )
    model.fit(X_train, y_train)
    return model


def _aggregate_fold_metrics(fold_metrics):
    """Mean/std across folds for scalar accuracy metrics (rmse, mae, r2)."""
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


async def predict_price_bagging(request: Request):
    try:
        # --------------------------
        # Parse JSON payload
        # --------------------------
        payload = await request.json()
        raw_data = payload.get("data", [])
        date_col = payload.get("date_variable")
        target_col = payload.get("target_variable")
        exog_cols = payload.get("exogenous_variable", [])
        cv_folds = int(payload.get("cv_folds", 3))

        # Regularization / diversity knobs, tunable but sensibly defaulted
        n_estimators = int(payload.get("n_estimators", 200))
        max_depth = payload.get("max_depth", 6)
        min_samples_leaf = int(payload.get("min_samples_leaf", 5))
        max_samples = float(payload.get("max_samples", 0.8))
        max_features = float(payload.get("max_features", 0.8))

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
        lag_cols = [c for c in df.columns if c.startswith(f"{target_col}_lag_")]

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
                fold_model = _fit_bagging(
                    X_tr, y_tr, n_estimators, max_depth, min_samples_leaf,
                    max_samples, max_features
                )
                fold_metrics.append(compute_bagging_metrics(fold_model, X_te, y_te, X.columns))
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

        model = _fit_bagging(
            X_train, y_train, n_estimators, max_depth, min_samples_leaf,
            max_samples, max_features
        )

        metrics = compute_bagging_metrics(model, X_test, y_test, X.columns)

        response = {
            "model": "BAGGING",
            "hyperparameters": {
                "n_estimators": n_estimators,
                "max_depth": max_depth,
                "min_samples_leaf": min_samples_leaf,
                "max_samples": max_samples,
                "max_features": max_features,
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