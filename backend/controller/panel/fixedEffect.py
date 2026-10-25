from fastapi.responses import JSONResponse
from sklearn.metrics import mean_squared_error, mean_absolute_error, r2_score
from sklearn.model_selection import TimeSeriesSplit, GroupKFold
import statsmodels.api as sm
from statsmodels.stats.outliers_influence import variance_inflation_factor
from statsmodels.stats.diagnostic import het_breuschpagan, het_white
from statsmodels.stats.stattools import jarque_bera
from scipy import stats
import pandas as pd
import numpy as np
import math

from controller.crossSectional.helpers import prepare_dataset


# ─────────────────────────────────────────
# HELPERS
# ─────────────────────────────────────────

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


def interpret_p(p, threshold=0.05):
    if p is None:
        return "unknown"
    return "significant" if p < threshold else "not significant"


# ─────────────────────────────────────────
# DIAGNOSTICS
# ─────────────────────────────────────────

def test_heteroskedasticity_panel(residuals, X_with_const):
    results = {}
    try:
        bp_lm, bp_p, _, _ = het_breuschpagan(residuals, X_with_const)
        bp_p_r = safe_round(bp_p)
        results["breusch_pagan"] = {
            "lm_statistic": safe_round(bp_lm),
            "p_value": bp_p_r,
            "interpretation": interpret_p(bp_p_r),
            "conclusion": (
                "Heteroskedasticity detected — consider cluster-robust standard errors."
                if bp_p_r is not None and bp_p_r < 0.05
                else "No significant heteroskedasticity detected."
            ),
        }
    except Exception as e:
        results["breusch_pagan"] = {"error": str(e)}

    try:
        w_lm, w_p, _, _ = het_white(residuals, X_with_const)
        w_p_r = safe_round(w_p)
        results["white_test"] = {
            "lm_statistic": safe_round(w_lm),
            "p_value": w_p_r,
            "interpretation": interpret_p(w_p_r),
            "conclusion": (
                "Heteroskedasticity detected — consider cluster-robust standard errors."
                if w_p_r is not None and w_p_r < 0.05
                else "No significant heteroskedasticity detected."
            ),
        }
    except Exception as e:
        results["white_test"] = {"error": str(e)}

    return results


def test_multicollinearity_panel(X_within):
    results = {}
    try:
        X_const = sm.add_constant(X_within, has_constant="add")
        vif_data = {}
        for i, col in enumerate(X_const.columns):
            if col == "const":
                continue
            vif   = variance_inflation_factor(X_const.values, i)
            vif_r = safe_round(vif, 4)
            vif_data[str(col)] = {
                "vif": vif_r,
                "conclusion": (
                    "Severe multicollinearity"   if (vif_r is not None and vif_r > 10) else
                    "Moderate multicollinearity" if (vif_r is not None and vif_r > 5)  else
                    "Acceptable"
                ),
            }
        results["vif"] = vif_data

        corr_matrix = X_within.corr().round(4)
        results["correlation_matrix"] = {
            str(c): {str(r): safe_round(v, 4) for r, v in row.items()}
            for c, row in corr_matrix.to_dict().items()
        }

        high_corr_pairs = []
        cols = X_within.columns.tolist()
        for i in range(len(cols)):
            for j in range(i + 1, len(cols)):
                r = corr_matrix.loc[cols[i], cols[j]]
                if abs(r) > 0.8:
                    high_corr_pairs.append({
                        "var1": str(cols[i]),
                        "var2": str(cols[j]),
                        "correlation": safe_round(r, 4),
                    })
        results["high_correlation_pairs"] = high_corr_pairs
        results["conclusion"] = (
            f"{len(high_corr_pairs)} highly correlated pair(s) detected (|r| > 0.8)."
            if high_corr_pairs
            else "No severe multicollinearity detected."
        )
    except Exception as e:
        results["error"] = str(e)
    return results


def test_serial_correlation_panel(residuals_df, entity_col="entity", time_col="time"):
    try:
        residuals_df = residuals_df.sort_values([entity_col, time_col]).copy()

        resid_lagged = (
            residuals_df
            .groupby(entity_col)["residual"]
            .shift(1)
        )
        df_ar = pd.DataFrame({
            "resid":     residuals_df["residual"].values,
            "resid_lag": resid_lagged.values,
        }).dropna()

        if len(df_ar) < 10:
            return {"error": "Not enough observations for serial correlation test."}

        X_ar     = sm.add_constant(df_ar["resid_lag"])
        ar_model = sm.OLS(df_ar["resid"], X_ar).fit()
        coef     = safe_round(ar_model.params.iloc[-1], 6)
        p        = safe_round(ar_model.pvalues.iloc[-1], 6)

        return {
            "ar1_coefficient": coef,
            "p_value":         p,
            "interpretation":  interpret_p(p),
            "conclusion": (
                "Serial correlation detected — consider clustered standard errors or GLS."
                if p is not None and p < 0.05
                else "No significant serial correlation detected."
            ),
        }
    except Exception as e:
        return {"error": str(e)}


def test_cross_sectional_dependence(residuals_df, entity_col="entity", time_col="time"):
    try:
        pivot = residuals_df.pivot_table(
            index=time_col, columns=entity_col, values="residual", aggfunc="mean"
        )
        pivot    = pivot.dropna(axis=1, how="all")
        entities = pivot.columns.tolist()
        N        = len(entities)
        T        = len(pivot)

        if N < 2:
            return {"error": "Need at least 2 entities for CD test."}

        corr_sum = 0.0
        pairs    = 0
        for i in range(N):
            for j in range(i + 1, N):
                combined = pd.concat(
                    [pivot.iloc[:, i], pivot.iloc[:, j]], axis=1
                ).dropna()
                if len(combined) < 3:
                    continue
                r, _ = stats.pearsonr(combined.iloc[:, 0], combined.iloc[:, 1])
                if not math.isnan(r):
                    corr_sum += r
                    pairs    += 1

        if pairs == 0:
            return {"error": "Could not compute correlations between entities."}

        cd_stat  = math.sqrt(2 * T / (N * (N - 1))) * corr_sum
        p_value  = 2 * (1 - stats.norm.cdf(abs(cd_stat)))
        p_val_r  = safe_round(p_value)

        return {
            "cd_statistic":   safe_round(cd_stat),
            "p_value":        p_val_r,
            "n_entities":     N,
            "t_periods":      T,
            "interpretation": interpret_p(p_val_r),
            "conclusion": (
                "Cross-sectional dependence detected — consider Driscoll-Kraay or clustered SE."
                if p_val_r is not None and p_val_r < 0.05
                else "No significant cross-sectional dependence detected."
            ),
        }
    except Exception as e:
        return {"error": str(e)}


def test_normality_panel(residuals):
    results = {}
    try:
        jb_stat, jb_p, jb_skew, jb_kurt = jarque_bera(residuals)
        jb_p_r = safe_round(jb_p)
        results["jarque_bera"] = {
            "statistic":      safe_round(jb_stat),
            "p_value":        jb_p_r,
            "skewness":       safe_round(jb_skew),
            "kurtosis":       safe_round(jb_kurt),
            "interpretation": interpret_p(jb_p_r),
            "conclusion": (
                "Residuals are not normally distributed."
                if jb_p_r is not None and jb_p_r < 0.05
                else "Residuals appear normally distributed."
            ),
        }
    except Exception as e:
        results["jarque_bera"] = {"error": str(e)}
    return results


# ─────────────────────────────────────────
# WITHIN TRANSFORMATION
# ─────────────────────────────────────────

def apply_within_transformation(df, y_col, X_cols, entity_col):
    """
    Vectorized entity demeaning — one groupby over all columns at once.
    """
    all_cols  = [y_col] + list(X_cols)
    grp_means = df.groupby(entity_col)[all_cols].transform("mean")
    y_within  = df[y_col] - grp_means[y_col]
    X_within  = df[list(X_cols)] - grp_means[list(X_cols)]
    return y_within, X_within

# ─────────────────────────────────────────
# TIME AXIS + OPTIONAL PER-ENTITY TREND
# ─────────────────────────────────────────
#
# A plain fixed effects forecast is  alpha_i + x_it * beta.  When the regressors are held at their
# latest values (no future_data supplied) that is flat across every forecast period. To let the
# forecast keep growing, the model can be split in two, exactly as in the boosting model:
#
#   1. an entity-specific trend (OLS on time, in logs for positive data), which extrapolates, and
#   2. fixed effects on what is left after removing that trend (the deviation from each entity's
#      own trend), driven by the regressors.
#
# Forecast = extrapolated trend + alpha_i + x * beta.
#
# trend="none" (the default) keeps the classic FE model and leaves every coefficient exactly as
# it was before. Use "auto" / "linear" / "log" to switch the trend stage on.

TREND_MODES = ("auto", "linear", "log", "none")
DEFAULT_TREND_MIN_PERIODS = 3
MAX_FORECAST_PERIODS = 60


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


def _sorted_periods(values):
    """Distinct period labels, oldest first, ordered by actual time rather than as text.
    Sorting as text puts '10/1/2020' before '2/1/2020' and '9/1/2024' after '12/1/2025',
    which would hold out (and cross-validate on) the wrong periods."""
    uniq = pd.Series(pd.unique(pd.Series(values).dropna()))
    try:
        t = _time_numeric(uniq)
    except ValueError:
        return sorted(uniq.tolist(), key=str)
    return uniq.iloc[np.argsort(t, kind="stable")].tolist()


def _json_label(v):
    """JSON-safe period label."""
    if isinstance(v, (pd.Timestamp, np.datetime64)):
        return pd.Timestamp(v).strftime("%Y-%m-%d")
    return v.item() if hasattr(v, "item") else v


NA_TOKENS = {"": None, "NA": None, "N/A": None, "na": None, "n/a": None, "null": None,
             "NULL": None, "None": None, "nan": None, "NaN": None, ".": None, "-": None}


def _check_text_predictors(raw_df, independent_cols, categorical_cols):
    """A predictor that holds text but isn't marked categorical becomes all-missing when it is
    converted to numbers, every row is then dropped, and the user only sees 'dataset too
    small'. Name the column instead."""
    bad = []
    for c in independent_cols:
        if c in categorical_cols or c not in raw_df.columns:
            continue
        s = raw_df[c].replace(NA_TOKENS)
        text = s.notna() & pd.to_numeric(s, errors="coerce").isna()
        if text.any():
            bad.append(f"'{c}' (e.g. {s[text].iloc[0]!r})")
    if bad:
        raise ValueError(
            f"Independent variable(s) {', '.join(bad)} contain text. Mark them as categorical "
            f"variables, or remove them."
        )


def _missing_report(before, after, cols, time_col):
    """What dropping rows with missing values cost: rows lost, the columns responsible, and
    whether recent periods were lost. If the latest period is lost, the model ends earlier
    than the data and the 'forecast' starts at a period that already has actual values."""
    rep = {
        "rows_in": int(len(before)),
        "rows_used": int(len(after)),
        "rows_dropped_missing": int(len(before) - len(after)),
        "missing_by_column": {str(c): int(n) for c, n in before[cols].isna().sum().items() if n > 0},
        "latest_period_in_data": None,
        "latest_period_used": None,
        "periods_lost": [],
        "warning": None,
    }
    if time_col and len(before):
        all_p = _sorted_periods(before[time_col])
        used = set(after[time_col].tolist()) if len(after) else set()
        lost = [p for p in all_p if p not in used]
        rep["latest_period_in_data"] = _json_label(all_p[-1])
        rep["latest_period_used"] = _json_label([p for p in all_p if p in used][-1]) if used else None
        rep["periods_lost"] = [_json_label(p) for p in lost][:24]
        if lost and lost[-1] == all_p[-1]:
            tail = []
            for p in reversed(all_p):
                if p in used:
                    break
                tail.append(_json_label(p))
            cols_txt = ", ".join(rep["missing_by_column"]) or "the model columns"
            rep["warning"] = (
                f"The latest period(s) {list(reversed(tail))} have missing values ({cols_txt}) in every "
                f"row, so they were left out: the model ends at {rep['latest_period_used']} and the "
                f"forecast starts right after it, inside periods that already have data. Fill those "
                f"values (e.g. carry the previous period forward) or drop the predictor."
            )
        elif lost:
            rep["warning"] = (
                f"{len(lost)} period(s) have no complete rows and were left out of the model "
                f"(e.g. {rep['periods_lost'][:3]})."
            )
    return rep


def _calendar_step_periods(idx, horizon):
    """Continue a date axis pandas couldn't assign a frequency to (usually because a period is
    missing). When every date is the 1st of a month, or every date is a month end, step by the
    most common number of whole months; a plain '31 days' step drifts (Oct 2, Nov 2, Dec 3).
    Otherwise use the most common gap in days."""
    months = pd.Series(idx.year * 12 + idx.month)
    steps = months.diff().dropna()
    steps = steps[steps > 0]
    month_start = bool((idx.day == 1).all())
    month_end = bool(idx.is_month_end.all())
    if len(steps) and (month_start or month_end):
        step = int(steps.mode().iloc[0])
        if month_end and not month_start:
            return pd.DatetimeIndex([idx[-1] + pd.offsets.MonthEnd(step * h) for h in range(1, horizon + 1)])
        return pd.DatetimeIndex([idx[-1] + pd.DateOffset(months=step * h) for h in range(1, horizon + 1)])
    delta = pd.Series(idx[1:] - idx[:-1]).mode().iloc[0]
    return pd.DatetimeIndex([idx[-1] + delta * h for h in range(1, horizon + 1)])


def _resolve_trend_mode(requested, df, dependent_col, time_col, min_periods):
    """Returns (mode, note). 'auto' = log trend for strictly positive targets,
    linear otherwise; falls back to 'none' when there is no usable time axis."""
    requested = str(requested if requested is not None else "none").strip().lower()
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
    g = pd.DataFrame({
        "id": pd.Series(ids).astype(str).to_numpy(),
        "t": np.asarray(t, float),
        "z": np.asarray(z, float),
    })
    t0 = float(g["t"].max())
    g["dt"] = g["t"] - t0

    stats_ = g.groupby("id").agg(n_t=("dt", "nunique"), mean_dt=("dt", "mean"), mean_z=("z", "mean"))
    g["dt_c"] = g["dt"] - g["id"].map(stats_["mean_dt"])
    g["z_c"] = g["z"] - g["id"].map(stats_["mean_z"])
    sxy = (g["dt_c"] * g["z_c"]).groupby(g["id"]).sum()
    sxx = (g["dt_c"] ** 2).groupby(g["id"]).sum()

    own = (stats_["n_t"] >= min_periods) & (sxx > 0)
    slope = (sxy / sxx.where(sxx > 0)).where(own)
    fallback = float(slope.median()) if slope.notna().any() else 0.0
    n_own = int(own.sum())
    slope = slope.fillna(fallback)
    level = stats_["mean_z"] - slope * stats_["mean_dt"]      # fitted level at t0

    return {
        "level": level, "slope": slope, "t0": t0, "fallback_slope": fallback,
        "mean_level": float(level.mean()), "n_own_slope": n_own, "n_entities": int(len(stats_)),
    }


def _trend_values(trend, ids, t):
    key = pd.Series(ids).astype(str).reset_index(drop=True)
    level = key.map(trend["level"]).fillna(trend["mean_level"]).to_numpy(float)
    slope = key.map(trend["slope"]).fillna(trend["fallback_slope"]).to_numpy(float)
    return level + slope * (np.asarray(t, float) - trend["t0"])


# ─────────────────────────────────────────
# FIT / PREDICT PIPELINE (optional trend + fixed effects)
# ─────────────────────────────────────────

def _combine(fit, linear_part, ids, t):
    """alpha_i + x*beta -> prediction in the units of the dependent variable."""
    if fit["trend"] is None:
        return np.asarray(linear_part, float)
    z = _trend_values(fit["trend"], ids, t) + np.asarray(linear_part, float)
    return np.exp(z) if fit["trend_mode"] == "log" else z


def _fit_fe_pipeline(train_df, dependent_col, X_cols, id_col, time_col,
                     trend_mode="none", min_periods=DEFAULT_TREND_MIN_PERIODS, strict=False):
    """
    Fit on `train_df`: (optional) entity trend -> within transformation -> OLS on demeaned data ->
    recover each entity's fixed effect  alpha_i = mean(target_i) - mean(X_i) @ beta.

    Returns a dict (everything needed to predict, plus the OLS objects the diagnostics use), or
    None when the model cannot be estimated. With strict=True it raises instead of returning None.
    """
    if train_df[id_col].nunique() < 2 or len(train_df) < 5:
        if strict:
            raise ValueError("Not enough data to estimate the Fixed Effects model")
        return None

    ids = train_df[id_col].reset_index(drop=True)
    y = train_df[dependent_col].to_numpy(float)

    trend, t = None, None
    if trend_mode != "none":
        t = _time_numeric(train_df[time_col])
        z = np.log(y) if trend_mode == "log" else y
        trend = _fit_entity_trends(ids, t, z, min_periods)
        target = z - _trend_values(trend, ids, t)
    else:
        target = y

    work = train_df[list(X_cols)].reset_index(drop=True).copy()
    work[id_col] = ids.values
    work["__target__"] = target

    y_within, X_within = apply_within_transformation(work, "__target__", X_cols, id_col)

    # Drop time-invariant columns (zero variance after demeaning)
    zero_var_cols = [c for c in X_within.columns if X_within[c].abs().max() < 1e-10]
    if zero_var_cols:
        X_within = X_within.drop(columns=zero_var_cols)

    used_cols = list(X_within.columns)
    if not used_cols:
        if strict:
            raise ValueError(
                "All independent variables are time-invariant within entities "
                "and were removed by the within transformation. "
                f"Dropped: {zero_var_cols}"
            )
        return None

    X_within_c = sm.add_constant(X_within, has_constant="add")
    try:
        model = sm.OLS(y_within, X_within_c).fit()
    except Exception:
        if strict:
            raise
        return None

    coef = model.params.drop("const", errors="ignore")[used_cols]

    entity_means = pd.Series(target, index=ids.index).groupby(ids).mean()
    X_means = work.groupby(id_col)[used_cols].mean()
    entity_fe = entity_means - X_means[used_cols].dot(coef)

    return {
        "model": model,
        "y_within": y_within,
        "X_within": X_within,
        "X_within_c": X_within_c,
        "zero_var_cols": zero_var_cols,
        "used_cols": used_cols,
        "coef": coef,
        "entity_fe": {str(k): float(v) for k, v in entity_fe.items()},
        "average_fe": float(entity_fe.mean()),
        "trend_mode": trend_mode,
        "trend": trend,
    }


def _predict_fe(fit, feats, ids, t):
    """Predict from a feature table + entity ids (+ numeric time when a trend is used).
    Entities not seen in training get the average fixed effect (and the average trend)."""
    ids = pd.Series(ids).reset_index(drop=True)
    alphas = ids.astype(str).map(fit["entity_fe"]).fillna(fit["average_fe"]).to_numpy(float)
    X = np.asarray(pd.DataFrame(feats)[fit["used_cols"]], float)
    linear = alphas + X @ fit["coef"].to_numpy(float)
    return _combine(fit, linear, ids, t)


def _predict_rows(fit, df_rows, X_cols, id_col, time_col):
    t = _time_numeric(df_rows[time_col]) if fit["trend"] is not None else None
    return _predict_fe(fit, df_rows[list(X_cols)], df_rows[id_col], t)


# ─────────────────────────────────────────
# CROSS-VALIDATION
# ─────────────────────────────────────────

def _run_fe_cv_fold(train_df, test_df, dependent_col, X_cols, id_col, time_col,
                    trend_mode, min_periods):
    if test_df.empty:
        return None

    fit = _fit_fe_pipeline(train_df, dependent_col, X_cols, id_col, time_col, trend_mode, min_periods)
    if fit is None:
        return None

    test_df = test_df.dropna(subset=fit["used_cols"] + [dependent_col, id_col])
    if test_df.empty:
        return None

    y_pred = _predict_rows(fit, test_df, X_cols, id_col, time_col)
    y_true = test_df[dependent_col].values

    mse = float(mean_squared_error(y_true, y_pred))
    return {
        "mse": safe_round(mse),
        "rmse": safe_round(np.sqrt(mse)),
        "mae": safe_round(mean_absolute_error(y_true, y_pred)),
        "r2": safe_round(r2_score(y_true, y_pred)),
        "n_test_rows": int(len(test_df)),
    }


def _aggregate_cv_metrics(fold_metrics):
    if not fold_metrics:
        return None
    agg = {}
    for key in ("mse", "rmse", "mae", "r2"):
        vals = [m[key] for m in fold_metrics if m.get(key) is not None]
        if vals:
            agg[key] = {
                "mean": safe_round(np.mean(vals)),
                "std": safe_round(np.std(vals)),
            }
    return agg


def run_fe_cross_validation(df, dependent_col, X_cols, id_col, time_col,
                            trend_mode="none", min_periods=DEFAULT_TREND_MIN_PERIODS, cv_folds=5):
    """
    Cross-validate the Fixed Effects model.

    Preferred: time-based walk-forward CV -- fold boundaries are drawn over unique time periods
    (not raw rows, so all entities sharing a period stay together); each fold fits the SAME
    pipeline as the final model and predicts later periods for the SAME entities using their
    training-estimated fixed effect. An FE model cannot predict for an entity it never saw, so
    "does it hold up in future periods for known entities" is the meaningful test.

    Fallback: no time_col or too few distinct periods -> entity-based GroupKFold. Held-out
    entities get the average fixed effect as a (necessarily weaker) stand-in, and no trend stage
    is used because unseen entities have no trend of their own.
    """
    fold_metrics = []
    method = None
    trend_used = "none"

    if time_col and df[time_col].nunique() >= cv_folds + 1:
        method = "time_based_walk_forward"
        trend_used = trend_mode
        unique_times = np.array(_sorted_periods(df[time_col]), dtype=object)
        splitter = TimeSeriesSplit(n_splits=cv_folds)
        for train_t_idx, test_t_idx in splitter.split(unique_times):
            train_times = set(unique_times[train_t_idx])
            test_times = set(unique_times[test_t_idx])
            train_df = df[df[time_col].isin(train_times)]
            test_df = df[df[time_col].isin(test_times)]
            result = _run_fe_cv_fold(train_df, test_df, dependent_col, X_cols, id_col, time_col,
                                     trend_mode, min_periods)
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
                result = _run_fe_cv_fold(train_df, test_df, dependent_col, X_cols, id_col, time_col,
                                         "none", min_periods)
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
# OUT-OF-SAMPLE TEST (the MSE that is reported and ranked)
# ─────────────────────────────────────────

def _label(v):
    """JSON-safe period label."""
    if isinstance(v, (pd.Timestamp, np.datetime64)):
        return pd.Timestamp(v).strftime("%Y-%m-%d")
    return v.item() if hasattr(v, "item") else v


def run_holdout_test(df, dependent_col, X_cols, id_col, time_col, fit_fn,
                     trend_requested, min_periods, horizon):
    """
    Pseudo-out-of-sample test that mimics the forecasting task: fit on every period except the
    last `horizon`, then predict those held-out periods and score them against the actual values.
    The model never sees the test periods; the entity effects (and trend, if on) are extrapolated
    into them exactly as they are for a real forecast.

    fit_fn(train_df, trend_mode) -> fitted pipeline (or None).

    Caveat: the regressors take their ACTUAL values in the test periods, while the published
    forecast has to hold them constant (unless future_data is supplied). If the regressors change
    a lot over time, real forecast error can be larger than this test shows.

    Returns (result_dict_or_None, note).
    """
    if not time_col:
        return None, "No date column, so periods cannot be held out"

    ordered = _sorted_periods(df[time_col])                # period labels, oldest first
    n_periods = len(ordered)

    min_train = max(min_periods + 1, 3)                    # enough history to fit entity effects/trend
    h = min(max(1, int(horizon)), n_periods - min_train)
    if h < 1:
        return None, f"Only {n_periods} periods; at least {min_train + 1} are needed to hold some out"

    test_labels = ordered[-h:]
    in_test = df[time_col].isin(test_labels)
    train_df, test_df = df[~in_test], df[in_test]

    # Entities that never appear in training have no fixed effect; leave them out and say so
    seen = set(train_df[id_col].astype(str))
    known = test_df[id_col].astype(str).isin(seen)
    n_excluded = int((~known).sum())
    test_df = test_df[known]
    if test_df.empty:
        return None, "No test rows for entities seen in training"

    trend_mode, _ = _resolve_trend_mode(trend_requested, train_df, dependent_col, time_col, min_periods)
    fit = fit_fn(train_df, trend_mode)
    if fit is None:
        return None, "The model could not be estimated on the training periods"

    test_df = test_df.dropna(subset=fit["used_cols"] + [dependent_col])
    if test_df.empty:
        return None, "No usable test rows"

    y_pred = _predict_rows(fit, test_df, X_cols, id_col, time_col)
    y_test = test_df[dependent_col]

    mse = float(mean_squared_error(y_test, y_pred))
    return {
        "basis": "holdout",
        "train_periods": int(n_periods - h),
        "test_periods": [_label(p) for p in test_labels],
        "n_test_rows": int(len(test_df)),
        "n_unseen_entity_rows_excluded": n_excluded,
        "trend": trend_mode,
        "regressors": "actual values in the test periods",
        "mse": safe_round(mse),
        "rmse": safe_round(np.sqrt(mse)),
        "mae": safe_round(mean_absolute_error(y_test, y_pred)),
        "r2": safe_round(r2_score(y_test, y_pred)),
    }, None


# ─────────────────────────────────────────
# FORECASTING
# ─────────────────────────────────────────

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
        future = _calendar_step_periods(idx, horizon)
    return [d.strftime("%Y-%m-%d") for d in future]


def forecast_fe_panel(fit, df, X_cols, id_col, time_col, horizon, raw_df_aligned,
                      independent_cols, future_data=None):
    """
    Predict the next `horizon` periods with the fitted pipeline
    (entity fixed effect + x * beta, plus the extrapolated entity trend when it is on).

    The regressors need values for the future periods. Two ways:

      * future_data (list of row dicts, optional): the caller supplies the regressors for each
        (entity, future period) -- e.g. a macro scenario. Rows need the id column, the date
        column and every model feature.
      * otherwise "carry_forward": each entity's regressors are held at their values in the
        latest period (the trend, if on, still moves forward).

    Returns {"rows": [...], "info": {...}}.
    """
    if not time_col:
        raise ValueError("A valid date_column is required to forecast future periods")

    entity_set = set(fit["entity_fe"])
    periods = _next_periods(df[time_col], horizon)
    tn = _time_numeric(df[time_col])
    last_time = df[time_col].iloc[int(np.argmax(tn))]
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
        feats = pd.concat([base[list(X_cols)]] * horizon, ignore_index=True)
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

        known = fut[id_col].astype(str).isin(entity_set)
        if (~known).any():
            skipped_entities = sorted(set(fut.loc[~known, id_col].astype(str)))
            warnings.append(
                f"future_data has {len(skipped_entities)} entity ID(s) that were not in the "
                f"training data (no fixed effect); those rows were not forecast"
            )
        fut = fut[known].reset_index(drop=True)
        if fut.empty:
            raise ValueError("No usable future_data rows after filtering")

        hs = fut["_key"].map(expected).to_numpy()
        period_labels = [periods[h - 1] for h in hs]
        feats = fut[list(X_cols)]
        ids = fut[id_col]
        inputs_df = fut[list(X_cols)]

    t = _time_numeric(period_labels) if fit["trend"] is not None else None
    preds = _predict_fe(fit, feats, ids, t)

    if mode == "carry_forward" and horizon > 1 and fit["trend"] is None:
        by_h = preds.reshape(horizon, -1)
        if np.allclose(by_h[0], by_h[-1]):
            warnings.append(
                "Forecasts are identical across periods. With no trend and the regressors held "
                "constant, the forecast is each entity's fixed effect plus x*beta at the latest "
                "values. Use trend='auto' or supply future_data with changing regressors for a "
                "period-specific forecast."
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

async def run_fixed_effects_prediction(request):
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
        # trend: "none" (default, classic FE), "auto" (log trend for positive targets, linear
        # otherwise), "linear", "log". forecast_periods is in units of the date column
        # (2 = next two fiscal years for annual data, next two months for monthly data, ...).
        trend_requested   = payload.get("trend", "none")
        trend_min_periods = int(payload.get("trend_min_periods", DEFAULT_TREND_MIN_PERIODS))
        forecast_periods  = int(payload.get("forecast_periods", 2))
        future_data       = payload.get("future_data", None)
        holdout_periods   = payload.get("holdout_periods", None)   # None = same as forecast_periods

        if not raw_data:
            raise ValueError("No data provided")
        if not dependent_col:
            raise ValueError("Dependent variable is required")
        if not independent_cols:
            raise ValueError("Independent variables are required")
        if not id_col:
            raise ValueError("Entity ID column is required for Fixed Effects")
        if cv_folds < 2:
            raise ValueError("cv_folds must be at least 2")
        if not (0 <= forecast_periods <= MAX_FORECAST_PERIODS):
            raise ValueError(f"forecast_periods must be between 0 and {MAX_FORECAST_PERIODS}")
        if trend_min_periods < 2:
            raise ValueError("trend_min_periods must be at least 2")

        if isinstance(remove_outliers, str):
            remove_outliers = remove_outliers.strip().lower() in ("yes", "true", "1")

        # Guard: entity/time cols must not be regressors
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

        _check_text_predictors(raw_df_aligned, independent_cols, categorical_cols or [])

        df[id_col] = raw_df_aligned[id_col].values
        if time_col and time_col in raw_df_aligned.columns:
            df[time_col] = raw_df_aligned[time_col].values
        else:
            time_col = None

        df_before_dropna = df
        df = df.dropna()
        data_quality = _missing_report(df_before_dropna, df, [dependent_col] + list(X_raw.columns), time_col)

        if len(df) < 5:
            raise ValueError(
                f"Only {len(df)} complete rows remain after dropping rows with missing values "
                f"(missing per column: {data_quality['missing_by_column']}), too few for Fixed Effects"
            )

        n_entities    = df[id_col].nunique()
        if n_entities < 2:
            raise ValueError(
                f"Fixed Effects requires at least 2 entities. "
                f"Found only 1 unique value in '{id_col}'. "
                f"Make sure id_column is 'ZipCode', not 'ID'."
            )

        entity_counts = df.groupby(id_col).size()
        if (entity_counts < 2).all():
            raise ValueError(
                "Each entity has only one observation. Fixed Effects requires "
                "multiple time periods per entity."
            )

        n_obs = len(df)
        X_cols = list(X_raw.columns)

        trend_mode, trend_note = _resolve_trend_mode(
            trend_requested, df, dependent_col, time_col, trend_min_periods
        )

        # ── Cross-validation (before the full-sample fit, over ALL rows) ──
        cross_validation = run_fe_cross_validation(
            df, dependent_col, X_cols, id_col, time_col,
            trend_mode=trend_mode, min_periods=trend_min_periods, cv_folds=cv_folds,
        )

        # ── Full-sample fit: (optional entity trend) + within transformation + OLS ──
        fit = _fit_fe_pipeline(
            df, dependent_col, X_cols, id_col, time_col,
            trend_mode, trend_min_periods, strict=True,
        )
        model         = fit["model"]
        y_within      = fit["y_within"]
        X_within      = fit["X_within"]
        X_within_c    = fit["X_within_c"]
        zero_var_cols = fit["zero_var_cols"]

        residuals     = model.resid
        fitted_values = model.fittedvalues

        # ── Degrees of freedom correction ──
        k                  = X_within.shape[1]
        df_resid_corrected = n_obs - n_entities - k

        # ── Within R² ──
        ss_res    = np.sum((y_within.values - fitted_values.values) ** 2)
        ss_tot    = np.sum((y_within.values - y_within.values.mean()) ** 2)
        within_r2 = safe_round(1 - ss_res / ss_tot if ss_tot != 0 else None)

        # ── Cluster-robust SE ──
        try:
            model_robust    = model.get_robustcov_results(
                cov_type="cluster", groups=df[id_col].values
            )
            param_index     = list(model.params.index)
            robust_se       = {str(k_): safe_round(v, 6) for k_, v in zip(param_index, model_robust.bse)}
            robust_p_values = {str(k_): safe_round(v, 6) for k_, v in zip(param_index, model_robust.pvalues)}
        except Exception as e:
            robust_se       = {"error": str(e)}
            robust_p_values = {"error": str(e)}

        # Errors of the within-transformed regression (the old "mse"/"mae"; not comparable across models)
        within_mse      = safe_round(mean_squared_error(y_within, fitted_values))
        within_mae      = safe_round(mean_absolute_error(y_within, fitted_values))
        p_values        = {str(k_): safe_round(v, 6) for k_, v in model.pvalues.items()}
        standard_errors = {str(k_): safe_round(v, 6) for k_, v in model.bse.items()}

        # ── In-sample fit in the ORIGINAL units of the dependent variable (alpha_i + x*beta [+ trend]) ──
        y_full = df[dependent_col]
        fitted_full = _predict_rows(fit, df, X_cols, id_col, time_col)
        in_sample_r2  = safe_round(r2_score(y_full, fitted_full))
        in_sample_mse = safe_round(mean_squared_error(y_full, fitted_full))
        in_sample_mae = safe_round(mean_absolute_error(y_full, fitted_full))

        # ── Residuals df for diagnostics ──
        resid_df = pd.DataFrame({
            "entity":   df[id_col].values,
            "time":     df[time_col].values if time_col else np.arange(n_obs),
            "residual": residuals.values,
        })

        # ── Diagnostics ──
        diagnostics = {
            "heteroskedasticity":         test_heteroskedasticity_panel(residuals, X_within_c),
            "multicollinearity":          test_multicollinearity_panel(X_within),
            "normality_of_residuals":     test_normality_panel(residuals),
            "serial_correlation":         test_serial_correlation_panel(resid_df, entity_col="entity", time_col="time"),
            "cross_sectional_dependence": test_cross_sectional_dependence(resid_df, entity_col="entity", time_col="time"),
        }

        # ── Entity fixed effects ──
        entity_fe = {k_: safe_round(v) for k_, v in fit["entity_fe"].items()}

        # ── Out-of-sample test: hold out the most recent periods, fit on the rest, score the held-out
        # periods. The reported mse/mae come from this test, NOT from the fit above, because an in-sample
        # error rewards models that memorise the training data. In-sample figures stay available as
        # in_sample_mse / in_sample_mae. ──
        horizon = int(holdout_periods) if holdout_periods else (forecast_periods if forecast_periods > 0 else 2)
        holdout, holdout_note = None, None
        try:
            holdout, holdout_note = run_holdout_test(
                df, dependent_col, X_cols, id_col, time_col,
                fit_fn=lambda tdf, tm: _fit_fe_pipeline(
                    tdf, dependent_col, X_cols, id_col, time_col, tm, trend_min_periods,
                ),
                trend_requested=trend_requested, min_periods=trend_min_periods, horizon=horizon,
            )
        except Exception as he:
            holdout_note = str(he)

        if holdout:
            mse, mae, mse_basis = holdout["mse"], holdout["mae"], "holdout"
        elif cross_validation.get("mse") and cross_validation.get("mae"):
            mse, mae = cross_validation["mse"]["mean"], cross_validation["mae"]["mean"]
            mse_basis = "walk_forward_cv" if cross_validation["method"] == "time_based_walk_forward" else "entity_cv"
        else:
            mse, mae, mse_basis = in_sample_mse, in_sample_mae, "in_sample"

        # ── Forecast the next `forecast_periods` periods ──
        # A forecasting problem must not break the model results, so any
        # failure is reported in forecast_error instead of failing the request.
        forecast = []
        forecast_info = None
        forecast_error = None
        if forecast_periods > 0:
            try:
                fc = forecast_fe_panel(
                    fit=fit,
                    df=df,
                    X_cols=X_cols,
                    id_col=id_col,
                    time_col=time_col,
                    horizon=forecast_periods,
                    raw_df_aligned=raw_df_aligned,
                    independent_cols=independent_cols,
                    future_data=future_data,
                )
                forecast = fc["rows"]
                forecast_info = fc["info"]
                if data_quality["warning"]:
                    forecast_info["warnings"].insert(0, data_quality["warning"])
            except Exception as fe:
                forecast_error = str(fe)

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
            "coefficients_describe": (
                "deviation from each entity's own trend" + (" (log points)" if trend_mode == "log" else "")
                if trend_mode != "none" else "dependent variable"
            ),
        }

        response_payload = sanitize({
            "success":        True,
            "model":          "FIXED EFFECTS",
            "n_entities":     n_entities,
            "n_observations": n_obs,
            "time_periods":   df[time_col].nunique() if time_col else None,
            "within_r2":      within_r2,
            "in_sample_r2":   in_sample_r2,
            "mse":            mse,                 # out-of-sample (see mse_basis)
            "mae":            mae,
            "mse_basis":      mse_basis,           # "holdout" | "walk_forward_cv" | "entity_cv" | "in_sample"
            "in_sample_mse":  in_sample_mse,
            "in_sample_mae":  in_sample_mae,
            "within_mse":     within_mse,          # old mse/mae: within-transformed regression
            "within_mae":     within_mae,
            "out_of_sample":  {**holdout, "note": None} if holdout else {"note": holdout_note},
            "f_statistic":    safe_round(model.fvalue),
            "f_pvalue":       safe_round(model.f_pvalue),
            "aic":            safe_round(model.aic),
            "bic":            safe_round(model.bic),
            "df_resid_corrected":              df_resid_corrected,
            "dropped_time_invariant_variables": zero_var_cols if zero_var_cols else None,
            "model_spec":              model_spec,
            "coefficients":            {str(k_): safe_round(v, 6) for k_, v in model.params.items()},
            "standard_errors":         standard_errors,
            "p_values":                p_values,
            "cluster_robust_se":       robust_se,
            "cluster_robust_p_values": robust_p_values,
            "entity_fixed_effects":    entity_fe,
            "cross_validation":        cross_validation,
            "diagnostics":             diagnostics,
            "forecast":        forecast,
            "forecast_info":   forecast_info,
            "forecast_error":  forecast_error,
            "data_quality":    data_quality,
        })

        return JSONResponse(content=response_payload)

    except Exception as e:
        return JSONResponse(
            content={
                "success": False,
                "error":   "Fixed Effects model execution failed",
                "details": str(e),
            },
            status_code=500,
        )