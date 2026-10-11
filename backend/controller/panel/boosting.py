from sklearn.ensemble import GradientBoostingRegressor
from sklearn.metrics import r2_score, mean_squared_error, mean_absolute_error
from sklearn.model_selection import TimeSeriesSplit, GroupKFold
from fastapi.responses import JSONResponse
import pandas as pd
import numpy as np
import math

from controller.crossSectional.helpers import prepare_dataset


def sanitize(obj):
    if isinstance(obj, dict):
        return {k: sanitize(v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [sanitize(v) for v in obj]
    if isinstance(obj, float):
        if math.isnan(obj) or math.isinf(obj):
            return None
        return obj
    if isinstance(obj, (np.floating, np.float32, np.float64)):
        f = float(obj)
        return None if (math.isnan(f) or math.isinf(f)) else round(f, 6)
    if isinstance(obj, (np.integer, np.int32, np.int64)):
        return int(obj)
    if isinstance(obj, np.bool_):
        return bool(obj)
    if isinstance(obj, np.ndarray):
        return sanitize(obj.tolist())
    return obj


def safe_round(v, digits=4):
    try:
        f = float(v)
        return None if (math.isnan(f) or math.isinf(f)) else round(f, digits)
    except Exception:
        return None


# ─────────────────────────────────────────
# TIME AXIS + PER-ENTITY TREND
# ─────────────────────────────────────────
#
# Why a trend stage: a tree ensemble can only predict values inside the range
# of the targets it was trained on, so on data that keeps rising it cannot
# forecast growth. The model is therefore split in two:
#
#   1. an entity-specific trend (OLS on time, in logs for positive data), which
#      extrapolates, and
#   2. gradient boosting on what is left after removing that trend (the
#      deviation from each entity's own trend), driven by the regressors.
#
# Forecast = extrapolated trend + boosted deviation. No lagged variables.

TREND_MODES = ("auto", "linear", "log", "none")
DEFAULT_TREND_MIN_PERIODS = 3


def _time_numeric(values):
    """Float time axis in 'years': numeric periods are used as they are,
    date-like periods become years since 1970 (days / 365.25)."""
    s = pd.Series(values).reset_index(drop=True)
    nums = pd.to_numeric(s, errors="coerce")
    if nums.notna().all():
        return nums.astype(float).to_numpy()
    dt = pd.to_datetime(s, errors="coerce")
    if dt.isna().any():
        raise ValueError("date_column could not be read as numbers or dates")
    return 1970.0 + (dt - pd.Timestamp("1970-01-01")).dt.days.to_numpy() / 365.25


def _resolve_trend_mode(requested, df, dependent_col, time_col, min_periods):
    """Returns (mode, note). 'auto' = log trend for strictly positive targets,
    linear otherwise; falls back to 'none' when there is no usable time axis."""
    requested = str(requested if requested is not None else "auto").strip().lower()
    if requested not in TREND_MODES:
        raise ValueError(f"trend must be one of {list(TREND_MODES)}")
    if requested == "none":
        return "none", None
    if not time_col:
        return "none", "No date_column, so no trend was fitted"
    if df[time_col].nunique() < min_periods:
        return "none", (
            f"Only {df[time_col].nunique()} distinct periods (need {min_periods}), so no trend was fitted"
        )
    positive = bool((df[dependent_col] > 0).all())
    if requested == "log" and not positive:
        raise ValueError("trend='log' needs a strictly positive dependent variable; use 'linear'")
    if requested == "auto":
        return ("log" if positive else "linear"), None
    return requested, None


def _fit_entity_trends(ids, t, z, min_periods):
    """Per-entity OLS  z = level_i + slope_i * (t - t0), with t0 = latest training time.
    Entities with fewer than `min_periods` distinct times get the median slope of
    the others (0 if nobody qualifies)."""
    g = pd.DataFrame({"id": pd.Series(ids).astype(str).to_numpy(), "t": np.asarray(t, float), "z": np.asarray(z, float)})
    t0 = float(g["t"].max())
    g["dt"] = g["t"] - t0

    stats = g.groupby("id").agg(n_t=("dt", "nunique"), mean_dt=("dt", "mean"), mean_z=("z", "mean"))
    g["dt_c"] = g["dt"] - g["id"].map(stats["mean_dt"])
    g["z_c"] = g["z"] - g["id"].map(stats["mean_z"])
    sxy = (g["dt_c"] * g["z_c"]).groupby(g["id"]).sum()
    sxx = (g["dt_c"] ** 2).groupby(g["id"]).sum()

    own = (stats["n_t"] >= min_periods) & (sxx > 0)
    slope = (sxy / sxx.where(sxx > 0)).where(own)
    fallback = float(slope.median()) if slope.notna().any() else 0.0
    n_own = int(own.sum())
    slope = slope.fillna(fallback)
    level = stats["mean_z"] - slope * stats["mean_dt"]      # fitted level at t0

    return {
        "level": level, "slope": slope, "t0": t0, "fallback_slope": fallback,
        "mean_level": float(level.mean()), "n_own_slope": n_own, "n_entities": int(len(stats)),
    }


def _trend_values(trend, ids, t):
    key = pd.Series(ids).astype(str).reset_index(drop=True)
    level = key.map(trend["level"]).fillna(trend["mean_level"]).to_numpy(float)
    slope = key.map(trend["slope"]).fillna(trend["fallback_slope"]).to_numpy(float)
    return level + slope * (np.asarray(t, float) - trend["t0"])


# ─────────────────────────────────────────
# FIT / PREDICT PIPELINE (trend + boosted residual)
# ─────────────────────────────────────────

def _design(fit, X_part, ids, time_index):
    """Feature matrix in the exact layout used at training time.
    Entity IDs are one-hot encoded (a tree can split on entity identity);
    unseen entities get all-zero dummies. time_index is a rank on the TRAINING
    period axis, so test and forecast rows must be mapped with the same time_map."""
    dummies = pd.get_dummies(pd.Series(ids).reset_index(drop=True), prefix="entity").reindex(
        columns=fit["entity_cols"], fill_value=0
    )
    X = pd.concat([pd.DataFrame(X_part).reset_index(drop=True), dummies], axis=1)
    if fit["use_time_index"]:
        X["time_index"] = np.asarray(time_index)
    return X.reindex(columns=fit["feature_cols"], fill_value=0)


def _combine(fit, boosted, ids, t):
    """Boosted output -> prediction in the units of the dependent variable."""
    if fit["trend"] is None:
        return np.asarray(boosted, float)
    z = _trend_values(fit["trend"], ids, t) + np.asarray(boosted, float)
    return np.exp(z) if fit["trend_mode"] == "log" else z


def _fit_pipeline(train_df, dependent_col, X_cols, id_col, time_col, gb_params,
                  trend_mode, time_map, use_time_index, min_periods):
    ids = train_df[id_col].reset_index(drop=True)
    entity_cols = list(pd.get_dummies(ids, prefix="entity").columns)
    use_ti = bool(time_col) and bool(use_time_index) and time_map is not None
    fit = {
        "entity_cols": entity_cols,
        "use_time_index": use_ti,
        "feature_cols": list(X_cols) + entity_cols + (["time_index"] if use_ti else []),
        "trend_mode": trend_mode,
        "trend": None,
    }

    y = train_df[dependent_col].to_numpy(float)
    t = None
    if trend_mode != "none":
        t = _time_numeric(train_df[time_col])
        z = np.log(y) if trend_mode == "log" else y
        fit["trend"] = _fit_entity_trends(ids, t, z, min_periods)
        target = z - _trend_values(fit["trend"], ids, t)
    else:
        target = y

    ti = train_df[time_col].map(time_map).to_numpy() if use_ti else None
    X_train = _design(fit, train_df[X_cols], ids, ti)

    model = GradientBoostingRegressor(**gb_params)
    model.fit(X_train, target)

    fit.update({"model": model, "X_train": X_train, "t_train": t, "time_index_train": ti})
    return fit


def _predict_rows(fit, df_rows, X_cols, id_col, time_col, time_map):
    ti = df_rows[time_col].map(time_map).to_numpy() if fit["use_time_index"] else None
    t = _time_numeric(df_rows[time_col]) if fit["trend"] is not None else None
    X = _design(fit, df_rows[X_cols], df_rows[id_col], ti)
    return _combine(fit, fit["model"].predict(X), df_rows[id_col], t)


# ─────────────────────────────────────────
# CROSS-VALIDATION
# ─────────────────────────────────────────

def _fit_predict_boosting_fold(train_df, test_df, dependent_col, X_cols, id_col, time_col,
                               gb_params, trend_mode, time_map, use_time_index, min_periods):
    if train_df.empty or test_df.empty:
        return None

    fit = _fit_pipeline(train_df, dependent_col, X_cols, id_col, time_col, gb_params,
                        trend_mode, time_map, use_time_index, min_periods)
    y_pred = _predict_rows(fit, test_df, X_cols, id_col, time_col, time_map)
    y_test = test_df[dependent_col]

    mse = float(mean_squared_error(y_test, y_pred))
    return {
        "rmse": safe_round(np.sqrt(mse)),
        "mae": safe_round(mean_absolute_error(y_test, y_pred)),
        "r2": safe_round(r2_score(y_test, y_pred)),
        "n_test_rows": int(len(y_test)),
    }


def _aggregate_cv_metrics(fold_metrics):
    if not fold_metrics:
        return None
    agg = {}
    for key in ("rmse", "mae", "r2"):
        vals = [m[key] for m in fold_metrics if m.get(key) is not None]
        if vals:
            agg[key] = {
                "mean": safe_round(np.mean(vals)),
                "std": safe_round(np.std(vals)),
            }
    return agg


def run_boosting_cross_validation(df, dependent_col, X_cols, id_col, time_col, gb_params,
                                  trend_mode="none", time_map=None, use_time_index=True,
                                  min_periods=DEFAULT_TREND_MIN_PERIODS, cv_folds=3):
    """
    Time-based walk-forward CV when a usable date_column exists (each fold fits
    the SAME pipeline as the final model: trend + boosted residual); entity-based
    GroupKFold otherwise. Entity folds score unseen entities, which have no
    entity trend, so they use the plain boosting model without the trend stage.
    """
    fold_metrics = []
    method = None
    trend_used = "none"

    if time_col and df[time_col].nunique() >= cv_folds + 1:
        method = "time_based_walk_forward"
        trend_used = trend_mode
        unique_times = np.array(sorted(df[time_col].unique()))
        splitter = TimeSeriesSplit(n_splits=cv_folds)
        for train_t_idx, test_t_idx in splitter.split(unique_times):
            train_times = set(unique_times[train_t_idx])
            test_times = set(unique_times[test_t_idx])
            train_df = df[df[time_col].isin(train_times)]
            test_df = df[df[time_col].isin(test_times)]
            result = _fit_predict_boosting_fold(
                train_df, test_df, dependent_col, X_cols, id_col, time_col, gb_params,
                trend_mode, time_map, use_time_index, min_periods
            )
            if result:
                fold_metrics.append(result)
    else:
        n_entities = df[id_col].nunique()
        n_splits = min(cv_folds, n_entities) if n_entities >= 2 else 0
        if n_splits >= 2:
            method = "entity_based_group_kfold"
            gkf = GroupKFold(n_splits=n_splits)
            for train_idx, test_idx in gkf.split(df, groups=df[id_col]):
                train_df = df.iloc[train_idx]
                test_df = df.iloc[test_idx]
                result = _fit_predict_boosting_fold(
                    train_df, test_df, dependent_col, X_cols, id_col, time_col, gb_params,
                    "none", time_map, use_time_index, min_periods
                )
                if result:
                    fold_metrics.append(result)
        else:
            method = "skipped_insufficient_entities"

    return {
        "method": method,
        "trend": trend_used,
        "folds_requested": cv_folds,
        "folds_used": len(fold_metrics),
        **(_aggregate_cv_metrics(fold_metrics) or {}),
    }


# ─────────────────────────────────────────
# FORECASTING
# ─────────────────────────────────────────

MAX_FORECAST_PERIODS = 60


def _period_key(value):
    """Canonical string for a period label, so labels generated by the
    forecaster and labels supplied by the caller can be compared
    (2026, 2026.0 and "2026" all become "2026"; any date-like value
    becomes YYYY-MM-DD)."""
    num = pd.to_numeric(pd.Series([value]), errors="coerce").iloc[0]
    if pd.notna(num):
        return str(int(num)) if float(num).is_integer() else str(float(num))
    return pd.Timestamp(value).strftime("%Y-%m-%d")


def _next_periods(time_values, horizon):
    """Continue the observed time axis by `horizon` periods.

    - Numeric periods (e.g. fiscal years 2016..2025): last + the most common step.
    - Date-like periods: pandas' inferred frequency (annual, quarterly,
      monthly, ...), falling back to the most common gap between dates.
    Labels come back in the same style as the input (ints for numeric
    periods, YYYY-MM-DD strings for dates).
    """
    uniq = pd.Series(pd.unique(pd.Series(time_values)))

    nums = pd.to_numeric(uniq, errors="coerce")
    if nums.notna().all():
        vals = np.sort(nums.astype(float).unique())
        step = 1.0
        if len(vals) >= 2:
            step = float(pd.Series(np.diff(vals)).mode().iloc[0])
        out = [vals[-1] + step * h for h in range(1, horizon + 1)]
        return [int(v) if float(v).is_integer() else float(v) for v in out]

    dates = pd.to_datetime(uniq, errors="coerce")
    if dates.isna().any():
        raise ValueError(
            "date_column could not be read as numbers (e.g. years) or dates, "
            "so future periods cannot be generated"
        )
    idx = pd.DatetimeIndex(dates).sort_values().unique()
    if len(idx) < 2:
        raise ValueError("At least 2 distinct periods are needed to forecast")

    freq = pd.infer_freq(idx) if len(idx) >= 3 else None
    if freq:
        future = pd.date_range(start=idx[-1], periods=horizon + 1, freq=freq)[1:]
    else:
        delta = pd.Series(idx[1:] - idx[:-1]).mode().iloc[0]
        future = pd.DatetimeIndex([idx[-1] + delta * h for h in range(1, horizon + 1)])
    return [d.strftime("%Y-%m-%d") for d in future]


def forecast_boosting_panel(fit, df, X_cols, id_col, time_col, horizon, raw_df_aligned,
                            independent_cols, time_map, future_data=None):
    """
    Predict the next `horizon` periods with the fitted pipeline
    (extrapolated entity trend + boosted deviation).

    The boosted part needs regressor values for the future periods. Two ways:

      * future_data (list of row dicts, optional): the caller supplies the
        regressors for each (entity, future period) -- e.g. a macro scenario.
        Rows need the id column, the date column and every model feature.
      * otherwise "carry_forward": each entity's regressors are held at their
        values in the latest period (the trend still moves forward).

    Returns {"rows": [...], "info": {...}}.
    """
    if not time_col:
        raise ValueError("A valid date_column is required to forecast future periods")

    entity_set = set(fit["entity_cols"])
    periods = _next_periods(df[time_col], horizon)
    last_rank = len(time_map) - 1          # training time_index runs 0..last_rank
    last_time = max(time_map, key=time_map.get)
    warnings = []
    skipped_entities = []

    input_cols = [c for c in independent_cols if c in raw_df_aligned.columns]

    if not future_data:
        mode = "carry_forward"
        base = df[df[time_col] == last_time]
        if base.empty:
            raise ValueError("No observations in the latest period to forecast from")

        skipped_entities = sorted(
            set(df[id_col].astype(str)) - set(base[id_col].astype(str))
        )
        if skipped_entities:
            warnings.append(
                f"{len(skipped_entities)} entity ID(s) have no observation in the latest "
                f"period and were not forecast"
            )

        n = len(base)
        feats = pd.concat([base[X_cols]] * horizon, ignore_index=True)
        ids = pd.concat([base[id_col]] * horizon, ignore_index=True)
        inputs_df = pd.concat(
            [raw_df_aligned.reindex(base.index)[input_cols]] * horizon, ignore_index=True
        )
        hs = np.repeat(np.arange(1, horizon + 1), n)
        period_labels = [periods[h - 1] for h in hs]
        warnings.append(
            "Regressors were held at their latest observed values for every forecast period"
        )
    else:
        mode = "future_data"
        if set(X_cols) != set(independent_cols):
            raise ValueError(
                "future_data does not support categorical (one-hot encoded) variables; "
                "remove categorical_variable or omit future_data"
            )
        fut = pd.DataFrame(future_data)
        need = [id_col, time_col] + list(X_cols)
        missing = [c for c in need if c not in fut.columns]
        if missing:
            raise ValueError(
                f"future_data is missing columns {missing}. Each row needs the id column, "
                f"the date column and every model feature {list(X_cols)}"
            )

        fut[list(X_cols)] = fut[list(X_cols)].apply(pd.to_numeric, errors="coerce")
        if fut[list(X_cols)].isna().any().any():
            raise ValueError("future_data has missing or non-numeric values in the model features")

        expected = {_period_key(p): i + 1 for i, p in enumerate(periods)}
        fut["_key"] = fut[time_col].map(_period_key)
        in_horizon = fut["_key"].isin(expected)
        if not in_horizon.any():
            raise ValueError(f"No future_data rows match the forecast periods {periods}")
        if (~in_horizon).any():
            warnings.append(
                f"{int((~in_horizon).sum())} future_data row(s) fall outside the forecast "
                f"periods {periods} and were ignored"
            )
        fut = fut[in_horizon]

        known = fut[id_col].map(lambda v: f"entity_{v}" in entity_set)
        if (~known).any():
            skipped_entities = sorted(set(fut.loc[~known, id_col].astype(str)))
            warnings.append(
                f"future_data has {len(skipped_entities)} entity ID(s) that were not in the "
                f"training data; those rows were not forecast"
            )
        fut = fut[known].reset_index(drop=True)
        if fut.empty:
            raise ValueError("No usable future_data rows after filtering")

        hs = fut["_key"].map(expected).to_numpy()
        period_labels = [periods[h - 1] for h in hs]
        feats = fut[list(X_cols)]
        ids = fut[id_col]
        inputs_df = fut[list(X_cols)]

    ti = last_rank + np.asarray(hs)
    t = _time_numeric(period_labels) if fit["trend"] is not None else None
    X_fc = _design(fit, feats, ids, ti)
    preds = _combine(fit, fit["model"].predict(X_fc), ids, t)

    if mode == "carry_forward" and horizon > 1 and fit["trend"] is None:
        by_h = preds.reshape(horizon, -1)
        if np.allclose(by_h[0], by_h[-1]):
            warnings.append(
                "Forecasts are identical across periods. Tree models cannot extrapolate beyond "
                "the training range and the regressors are held constant, so the forecast equals "
                "the latest fitted level. Use a trend (trend='auto') or supply future_data with "
                "changing regressors for a period-specific forecast."
            )

    rows = []
    inputs_records = inputs_df.reset_index(drop=True).to_dict("records")
    ids_list = ids.reset_index(drop=True).tolist()
    for i in range(len(preds)):
        rows.append({
            "id": ids_list[i],
            "period": period_labels[i],
            "horizon": int(hs[i]),
            "predicted": safe_round(preds[i]),
            "inputs": inputs_records[i],
        })
    rows.sort(key=lambda r: (r["horizon"], str(r["id"])))

    return {
        "rows": rows,
        "info": {
            "mode": mode,
            "trend": fit["trend_mode"],
            "horizon": horizon,
            "periods": periods,
            "n_forecast_rows": len(rows),
            "n_entities_forecast": len(set(str(r["id"]) for r in rows)),
            "skipped_entities": skipped_entities[:50],
            "warnings": warnings,
        },
    }


# ─────────────────────────────────────────
# MAIN HANDLER
# ─────────────────────────────────────────

async def run_boosting_panel(request):
    try:
        payload = await request.json()

        raw_data         = payload.get("data", [])
        categorical_cols = payload.get("categorical_variable", [])
        dependent_col    = payload.get("dependent_variable")
        independent_cols = payload.get("independent_variable", [])
        id_col           = payload.get("id_column")
        time_col         = payload.get("date_column", None)
        remove_outliers  = payload.get("outliers", False)
        cv_folds         = int(payload.get("cv_folds", 3))

        # ── Trend + forecast settings ──
        # trend: "auto" (log trend for positive targets, linear otherwise), "linear", "log", "none".
        # forecast_periods is in units of the date column (2 = next two
        # fiscal years for annual data, next two months for monthly data, ...).
        trend_requested  = payload.get("trend", "auto")
        trend_min_periods = int(payload.get("trend_min_periods", DEFAULT_TREND_MIN_PERIODS))
        use_time_index   = payload.get("use_time_index", None)   # None = automatic, see below
        forecast_periods = int(payload.get("forecast_periods", 2))
        future_data      = payload.get("future_data", None)

        # ── Gradient Boosting hyperparameters ──
        n_estimators      = int(payload.get("n_estimators", 200))
        learning_rate     = float(payload.get("learning_rate", 0.05))
        max_depth         = int(payload.get("max_depth", 3))
        min_samples_split = int(payload.get("min_samples_split", 10))
        min_samples_leaf  = int(payload.get("min_samples_leaf", 5))
        subsample         = float(payload.get("subsample", 0.8))
        max_features      = payload.get("max_features", None)
        random_state      = int(payload.get("random_state", 42))
        validation_fraction = float(payload.get("validation_fraction", 0.1))
        n_iter_no_change  = payload.get("n_iter_no_change", 10)
        tol               = float(payload.get("tol", 1e-4))

        if n_iter_no_change is not None:
            n_iter_no_change = int(n_iter_no_change)

        # ── Validation ──
        if not raw_data:
            raise ValueError("No data provided")
        if not dependent_col:
            raise ValueError("Dependent variable is required")
        if not independent_cols:
            raise ValueError("Independent variables are required")
        if not id_col:
            raise ValueError("Entity ID column is required for panel Boosting")
        if not (0.0 < subsample <= 1.0):
            raise ValueError("subsample must be in (0.0, 1.0]")
        if not (0.0 < learning_rate):
            raise ValueError("learning_rate must be positive")
        if cv_folds < 2:
            raise ValueError("cv_folds must be at least 2")
        if not (0 <= forecast_periods <= MAX_FORECAST_PERIODS):
            raise ValueError(f"forecast_periods must be between 0 and {MAX_FORECAST_PERIODS}")
        if trend_min_periods < 2:
            raise ValueError("trend_min_periods must be at least 2")

        if isinstance(remove_outliers, str):
            remove_outliers = remove_outliers.strip().lower() in ("yes", "true", "1")
        if isinstance(use_time_index, str):
            use_time_index = use_time_index.strip().lower() in ("yes", "true", "1")

        independent_cols = [c for c in independent_cols if c != id_col]
        if time_col:
            independent_cols = [c for c in independent_cols if c != time_col]
        if not independent_cols:
            raise ValueError(
                f"No independent variables remain after excluding id_column ('{id_col}') "
                f"and date_column ('{time_col}'). "
                f"If you are using 'Year' as a regressor, set date_column to 'Date' not 'Year'."
            )

        # ── Prepare dataset ──
        prepared = prepare_dataset(
            raw_data=raw_data,
            dependent_col=dependent_col,
            independent_cols=independent_cols,
            categorical_cols=categorical_cols,
            id_col=id_col,
            remove_outliers=remove_outliers,
        )

        X_raw = prepared["X"].copy().apply(pd.to_numeric, errors="coerce")
        y_raw = pd.to_numeric(prepared["y"].copy(), errors="coerce")

        # ── Rebuild panel df aligned by surviving index ──
        df = X_raw.copy()
        df[dependent_col] = y_raw.values

        raw_df         = pd.DataFrame(raw_data)
        raw_df_aligned = raw_df.loc[df.index] if len(raw_df) != len(df) else raw_df

        if id_col not in raw_df_aligned.columns:
            raise ValueError(f"id_column '{id_col}' not found in input data")

        df[id_col] = raw_df_aligned[id_col].values
        if time_col and time_col in raw_df_aligned.columns:
            df[time_col] = raw_df_aligned[time_col].values
        else:
            time_col = None

        df = df.dropna()

        if len(df) < 5:
            raise ValueError("Dataset too small for panel Boosting")

        n_entities = df[id_col].nunique()
        if n_entities < 2:
            raise ValueError(
                f"Panel Boosting requires at least 2 entities. "
                f"Found only 1 unique value in '{id_col}'. "
                f"Make sure id_column is the entity identifier, not a row ID."
            )

        entity_counts = df.groupby(id_col).size()
        if (entity_counts < 2).all():
            raise ValueError(
                "Each entity has only one observation. "
                "Panel Boosting needs multiple time periods per entity."
            )

        n_obs  = len(df)
        X_cols = list(X_raw.columns)

        # One period -> rank map for the WHOLE sample, reused by every CV fold and by
        # the forecast, so a given period always has the same time_index.
        time_map = None
        if time_col:
            _, uniques = pd.factorize(df[time_col], sort=True)
            time_map = {u: i for i, u in enumerate(uniques)}

        trend_mode, trend_note = _resolve_trend_mode(
            trend_requested, df, dependent_col, time_col, trend_min_periods
        )

        # time_index lets the trees see which period a row belongs to. Without a trend stage it
        # is the only time signal, so it stays on. With a trend it is off by default: it would carry
        # the latest common shock (e.g. a one-off surge) into every forecast period.
        if use_time_index is None:
            use_time_index = (trend_mode == "none")

        gb_params = {
            "n_estimators": n_estimators,
            "learning_rate": learning_rate,
            "max_depth": max_depth,
            "min_samples_split": min_samples_split,
            "min_samples_leaf": min_samples_leaf,
            "subsample": subsample,
            "max_features": max_features,
            "random_state": random_state,
            "validation_fraction": validation_fraction,
            "n_iter_no_change": n_iter_no_change,
            "tol": tol,
        }

        # ── Cross-validation. No per-fold hyperparameter search --
        # fixed gb_params reused across folds. ──
        cross_validation = run_boosting_cross_validation(
            df, dependent_col, X_cols, id_col, time_col, gb_params,
            trend_mode=trend_mode, time_map=time_map, use_time_index=use_time_index,
            min_periods=trend_min_periods, cv_folds=cv_folds,
        )

        # ── Full-sample fit: entity trend + boosting on the deviation from it ──
        fit = _fit_pipeline(
            df, dependent_col, X_cols, id_col, time_col, gb_params,
            trend_mode, time_map, use_time_index, trend_min_periods,
        )
        model  = fit["model"]
        X_full = fit["X_train"]
        entity_cols = fit["entity_cols"]
        y_full = df[dependent_col]
        ids_full = df[id_col]
        t_full = fit["t_train"]

        fitted = _combine(fit, model.predict(X_full), ids_full, t_full)

        n_estimators_used = model.n_estimators_

        in_sample_r2 = safe_round(r2_score(y_full, fitted))
        mse          = safe_round(mean_squared_error(y_full, fitted))
        mae          = safe_round(mean_absolute_error(y_full, fitted))

        # ── Forecast the next `forecast_periods` periods ──
        # A forecasting problem must not break the model results, so any
        # failure is reported in forecast_error instead of failing the request.
        forecast = []
        forecast_info = None
        forecast_error = None
        if forecast_periods > 0:
            try:
                fc = forecast_boosting_panel(
                    fit=fit,
                    df=df,
                    X_cols=X_cols,
                    id_col=id_col,
                    time_col=time_col,
                    horizon=forecast_periods,
                    raw_df_aligned=raw_df_aligned,
                    independent_cols=independent_cols,
                    time_map=time_map,
                    future_data=future_data,
                )
                forecast = fc["rows"]
                forecast_info = fc["info"]
            except Exception as fe:
                forecast_error = str(fe)

        # ── Training deviance (loss per boosting iteration, on the deviation from trend) ──
        train_deviance = [safe_round(v) for v in model.train_score_]

        # ── Feature importances ──
        all_feature_names = list(X_full.columns)
        importances = model.feature_importances_
        importance_dict = {
            str(name): safe_round(imp, 6)
            for name, imp in zip(all_feature_names, importances)
        }

        # Collapse per-entity one-hot dummies into a single "entity_id"
        # importance figure -- individual dummy columns aren't
        # meaningful on their own.
        entity_importance_total = safe_round(
            sum(importance_dict.get(c, 0) or 0 for c in entity_cols), 6
        )
        base_feature_importances = {
            k: v for k, v in importance_dict.items() if k not in entity_cols
        }
        if "entity_id" not in base_feature_importances:
            base_feature_importances["entity_id"] = entity_importance_total

        ranked_importances = sorted(
            base_feature_importances.items(), key=lambda x: (x[1] or 0), reverse=True
        )
        ranked_importances = [{"variable": k, "importance": v} for k, v in ranked_importances]

        # ── Per-stage prediction: cumulative R² at each boosting round,
        # on the full sample and in the original units (in-sample -- CV above
        # is the honest out-of-sample estimate). Sampled at up to 20 evenly
        # spaced checkpoints to keep payload small.
        staged_r2 = []
        try:
            checkpoints = set(
                np.linspace(0, n_estimators_used - 1, min(20, n_estimators_used), dtype=int)
            )
            for i, staged_pred in enumerate(model.staged_predict(X_full)):
                if i in checkpoints:
                    staged_r2.append({
                        "iteration": i + 1,
                        "r2": safe_round(r2_score(y_full, _combine(fit, staged_pred, ids_full, t_full))),
                    })
        except Exception:
            staged_r2 = []

        # ── Raw entity means of the dependent variable ──
        # Descriptive statistic (observed group means), NOT a
        # model-estimated fixed effect -- boosting doesn't produce
        # linear coefficients the way FE/RE do.
        entity_mean_dependent = {
            str(ent): safe_round(df.loc[df[id_col] == ent, dependent_col].mean())
            for ent in df[id_col].unique()
        }

        trend_info = fit["trend"]
        model_spec = {
            "trend": trend_mode,
            "trend_note": trend_note,
            "trend_min_periods": trend_min_periods,
            "entities_with_own_trend": trend_info["n_own_slope"] if trend_info else None,
            "median_trend_slope": safe_round(trend_info["fallback_slope"], 6) if trend_info else None,
            "slope_units": (
                "log points per period-unit (e.g. 0.04 = about 4% a year for annual data)" if trend_mode == "log"
                else "dependent-variable units per period-unit" if trend_mode == "linear" else None
            ),
            "time_index_feature": fit["use_time_index"],
            "importance_target": (
                "deviation from each entity's own trend" if trend_mode != "none" else "dependent variable"
            ),
        }

        return JSONResponse(content=sanitize({
            "success":        True,
            "model":          "BOOSTING PANEL",
            "n_entities":     n_entities,
            "n_observations": n_obs,
            "time_periods":   df[time_col].nunique() if time_col else None,
            "in_sample_r2":   in_sample_r2,
            "mse":            mse,
            "mae":            mae,
            "cross_validation": cross_validation,
            "model_spec":     model_spec,
            "boosting": {
                "n_estimators_requested":   n_estimators,
                "n_estimators_used":        n_estimators_used,
                "early_stopping_triggered": n_estimators_used < n_estimators,
                "learning_rate":            learning_rate,
                "max_depth":                max_depth,
                "min_samples_split":        min_samples_split,
                "min_samples_leaf":         min_samples_leaf,
                "subsample":                subsample,
                "max_features":             max_features,
                "n_iter_no_change":         n_iter_no_change,
                "validation_fraction":      validation_fraction,
                "tol":                      tol,
                "n_base_features":          len(X_cols),
                "n_entity_dummies":         len(entity_cols),
                "uses_time_index":          fit["use_time_index"],
            },
            "train_deviance":              train_deviance,
            "staged_r2":                   staged_r2,
            "feature_importance":         base_feature_importances,
            "feature_importances_ranked":  ranked_importances,
            "coefficients":            {k: None for k in X_cols},
            "standard_errors":         {k: None for k in X_cols},
            "p_values":                {k: None for k in X_cols},
            "cluster_robust_se":       {},
            "cluster_robust_p_values": {},
            "entity_mean_dependent_variable": entity_mean_dependent,
            "forecast":        forecast,
            "forecast_info":   forecast_info,
            "forecast_error":  forecast_error,
        }))

    except Exception as e:
        return JSONResponse(
            content={
                "success": False,
                "error":   "Panel Boosting model execution failed",
                "details": str(e),
            },
            status_code=500,
        )