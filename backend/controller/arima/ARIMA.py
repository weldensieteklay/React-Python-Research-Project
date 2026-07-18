from fastapi import Request
from fastapi.responses import JSONResponse
import pandas as pd
import numpy as np

from joblib import Parallel, delayed
from sklearn.model_selection import TimeSeriesSplit

from .preprocessing import clean_input_data
from .helpers import preprocess_exog, compute_metrics, to_serializable
from .model_utils import fit_arima_model
from .summary_utils import extract_model_summary


def _run_fold(train_idx, test_idx, df, target_col, exog_df):
    """One walk-forward CV fold. Standalone function so folds can be
    fit in parallel -- each fold is independent of the others."""
    train = df.iloc[train_idx]
    test = df.iloc[test_idx]

    exog_train = exog_df.iloc[train_idx] if exog_df is not None else None
    exog_test = exog_df.iloc[test_idx] if exog_df is not None else None
    if exog_train is not None and exog_test is not None:
        exog_test = exog_test.reindex(columns=exog_train.columns, fill_value=0)

    try:
        results, _ = fit_arima_model(train[target_col], exog=exog_train)
        return compute_metrics(results, test, target_col, exog_test=exog_test)
    except Exception:
        return None


def _aggregate_fold_metrics(fold_metrics):
    """Mean/std across folds for whatever numeric keys compute_metrics
    returns, without assuming its exact schema."""
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


async def predict_price(request: Request):
    try:
        payload = await request.json()

        raw_data = payload.get("data", [])
        date_col = payload.get("date_variable")
        target_col = payload.get("target_variable")
        exog_cols = payload.get("exogenous_variable", [])
        cv_folds = int(payload.get("cv_folds", 3))

        if not raw_data or not date_col or not target_col:
            return JSONResponse({
                "error": "data, date_variable, and target_variable are required"
            }, status_code=400)

        if cv_folds < 2:
            return JSONResponse({"error": "cv_folds must be at least 2"}, status_code=400)

        # -------------------------
        # Load & clean
        # -------------------------
        df = clean_input_data(raw_data)

        df[date_col] = pd.to_datetime(df[date_col], errors="coerce")
        df[target_col] = pd.to_numeric(df[target_col], errors="coerce")

        for col in exog_cols:
            df[col] = pd.to_numeric(df[col], errors="coerce")

        df = df.dropna(subset=[date_col, target_col] + exog_cols)
        df.sort_values(by=date_col, inplace=True)
        df.set_index(date_col, inplace=True)

        min_required = max(10, cv_folds * 5)
        if len(df) < min_required:
            return JSONResponse({
                "error": f"Not enough observations: need at least {min_required} "
                         f"for {cv_folds}-fold CV, got {len(df)}"
            }, status_code=400)

        exog_df = preprocess_exog(df, exog_cols) if exog_cols else None

        # -------------------------
        # Walk-forward cross-validation.
        # TimeSeriesSplit only ever trains on the past and tests on the
        # following block (no shuffling -- shuffled k-fold would leak
        # future data into training for a time series). Folds are
        # independent, so they're fit in parallel to keep this fast.
        # -------------------------
        tscv = TimeSeriesSplit(n_splits=cv_folds)
        splits = list(tscv.split(df))

        fold_results = Parallel(n_jobs=-1, prefer="threads")(
            delayed(_run_fold)(train_idx, test_idx, df, target_col, exog_df)
            for train_idx, test_idx in splits
        )
        fold_metrics = [m for m in fold_results if m is not None]

        cross_validation = {
            "folds_requested": cv_folds,
            "folds_used": len(fold_metrics),
            **(_aggregate_fold_metrics(fold_metrics) or {}),
        }

        # -------------------------
        # Final hold-out fit (last 80/20 split) -- the reportable model
        # -------------------------
        split = int(len(df) * 0.8)
        train = df.iloc[:split]
        test = df.iloc[split:]

        exog_train = exog_df.iloc[:split] if exog_df is not None else None
        exog_test = exog_df.iloc[split:] if exog_df is not None else None
        if exog_train is not None and exog_test is not None:
            exog_test = exog_test.reindex(columns=exog_train.columns, fill_value=0)

        results, stationarity = fit_arima_model(
            train[target_col],
            exog=exog_train
        )

        metrics = compute_metrics(
            results,
            test,
            target_col,
            exog_test=exog_test
        )

        response = {
            **metrics,
            "model": "ARIMAX" if exog_train is not None else "ARIMA",
            "used_exog": exog_train is not None,
            "stationary": stationarity["stationary"],
            "adfuller_p": round(stationarity["p_value"], 4),
            "rows_used": int(len(df)),
            "cross_validation": cross_validation,
            "data": extract_model_summary(results, target_col),
        }
        return JSONResponse(to_serializable(response))

    except Exception as e:
        return JSONResponse({
            "error": "Model execution failed",
            "details": repr(e)
        }, status_code=500)