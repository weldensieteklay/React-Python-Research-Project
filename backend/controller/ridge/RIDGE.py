from fastapi import Request, HTTPException
from sklearn.linear_model import RidgeCV
from sklearn.preprocessing import StandardScaler
from sklearn.model_selection import TimeSeriesSplit
import pandas as pd
import numpy as np

from ..common.helper import (
    clean_input_data,
    preprocess_exog,
    compute_ridge_metrics,
    to_serializable,
    create_lag_features
)


def _scale(X_train, X_test):
    """Fit the scaler on train only, apply to both -- keeps DataFrame
    columns/index so downstream helpers (compute_ridge_metrics) still
    see feature names."""
    scaler = StandardScaler()
    X_train_scaled = pd.DataFrame(
        scaler.fit_transform(X_train), columns=X_train.columns, index=X_train.index
    )
    X_test_scaled = pd.DataFrame(
        scaler.transform(X_test), columns=X_test.columns, index=X_test.index
    )
    return X_train_scaled, X_test_scaled


def _fit_ridge(X_train, y_train, inner_cv_folds=3):
    """
    RidgeCV with a TimeSeriesSplit for its internal alpha-selection CV
    instead of the default fold splitting, so choosing the
    regularization strength doesn't use later observations to help
    predict earlier ones. A log-spaced alpha grid covers a wider range
    than a handful of fixed values.
    """
    inner_cv = TimeSeriesSplit(n_splits=inner_cv_folds)
    alphas = np.logspace(-2, 3, 25)  # 0.01 .. 1000, 25 candidates
    ridge = RidgeCV(alphas=alphas, cv=inner_cv)
    ridge.fit(X_train, y_train)
    return ridge


def _aggregate_fold_metrics(fold_metrics):
    """Mean/std across folds for whatever numeric keys
    compute_ridge_metrics returns, without assuming its exact schema."""
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


async def predict_price_ridge(request: Request):
    try:
        payload = await request.json()

        raw_data = payload.get("data", [])
        date_col = payload.get("date_variable")
        target_col = payload.get("target_variable")
        exog_cols = payload.get("exogenous_variable", [])
        cv_folds = int(payload.get("cv_folds", 3))

        if not raw_data or not date_col or not target_col:
            raise HTTPException(status_code=400, detail="Missing required fields")

        if cv_folds < 2:
            raise HTTPException(status_code=400, detail="cv_folds must be at least 2")

        # -------------------------------
        # Load and clean
        # -------------------------------
        df = clean_input_data(raw_data)
        df[date_col] = pd.to_datetime(df[date_col])
        df[target_col] = pd.to_numeric(df[target_col], errors="coerce")
        df.sort_values(by=date_col, inplace=True)

        # -------------------------------
        # Create lag features
        # -------------------------------
        df = create_lag_features(df, target_col, num_lags=3)
        lag_cols = [col for col in df.columns if col.startswith(f"{target_col}_lag_")]

        if not lag_cols and not exog_cols:
            raise HTTPException(status_code=400, detail="No features found for model")

        # -------------------------------
        # Build feature matrix
        # -------------------------------
        X_parts = []

        if lag_cols:
            X_parts.append(df[lag_cols])

        if exog_cols:
            exog_df = preprocess_exog(df, exog_cols)
            X_parts.append(exog_df)

        X = pd.concat(X_parts, axis=1)

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

        # -------------------------------
        # Walk-forward outer cross-validation.
        # Each fold trains only on the past and tests on the block
        # right after it -- no shuffling, since shuffled k-fold would
        # leak future rows (including lag features built from them)
        # into training.
        # -------------------------------
        outer_cv = TimeSeriesSplit(n_splits=cv_folds)
        fold_metrics = []

        for train_idx, test_idx in outer_cv.split(X):
            X_tr, X_te = X.iloc[train_idx], X.iloc[test_idx]
            y_tr, y_te = y.iloc[train_idx], y.iloc[test_idx]

            # keep the inner RidgeCV fold count sane for small folds
            inner_folds = min(3, max(2, len(X_tr) // 10))

            try:
                X_tr_scaled, X_te_scaled = _scale(X_tr, X_te)
                fold_ridge = _fit_ridge(X_tr_scaled, y_tr, inner_cv_folds=inner_folds)
                fold_metrics.append(
                    compute_ridge_metrics(fold_ridge, X_te_scaled, y_te, X.columns)
                )
            except Exception:
                continue

        cross_validation = {
            "folds_requested": cv_folds,
            "folds_used": len(fold_metrics),
            **(_aggregate_fold_metrics(fold_metrics) or {}),
        }

        # -------------------------------
        # Final hold-out fit (last 80/20 split) -- the reportable model
        # -------------------------------
        split_index = int(len(X) * 0.8)
        X_train, X_test = X.iloc[:split_index], X.iloc[split_index:]
        y_train, y_test = y.iloc[:split_index], y.iloc[split_index:]

        X_train_scaled, X_test_scaled = _scale(X_train, X_test)
        ridge = _fit_ridge(X_train_scaled, y_train)

        metrics = compute_ridge_metrics(ridge, X_test_scaled, y_test, X.columns)

        response = {
            "model": "RIDGE",
            "alpha_selected": round(float(ridge.alpha_), 6),
            "rows_used": int(len(X)),
            "cross_validation": cross_validation,
            **metrics,
        }
        return to_serializable(response)

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=repr(e))