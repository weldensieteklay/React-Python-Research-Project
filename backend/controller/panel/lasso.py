from sklearn.linear_model import Lasso
from sklearn.metrics import r2_score, mean_squared_error, mean_absolute_error
from sklearn.model_selection import TimeSeriesSplit, GroupKFold
from fastapi.responses import JSONResponse
import statsmodels.api as sm
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
# WITHIN TRANSFORMATION / FOLD FITTING
# ─────────────────────────────────────────

def _fit_lasso_fold(train_df, dependent_col, X_cols, id_col, alpha):
    """
    Fit Lasso on ONE fold's training rows only: entity means used for
    demeaning are computed from train_df alone, so no information
    about held-out rows leaks into how training rows get demeaned.
    Also recovers each training entity's fixed effect
    (alpha_i = mean(y_i) - mean(X_i) @ beta, using ALL coefficients
    including any Lasso zeroed out) so held-out rows for that entity
    can be predicted on the original (level) scale.
    """
    if train_df[id_col].nunique() < 2 or len(train_df) < 5:
        return None

    all_cols = [dependent_col] + list(X_cols)
    grp_means = train_df.groupby(id_col)[all_cols].transform("mean")
    y_within = train_df[dependent_col] - grp_means[dependent_col]
    X_within = train_df[X_cols] - grp_means[X_cols]

    zero_var_cols = [c for c in X_within.columns if X_within[c].abs().max() < 1e-10]
    if zero_var_cols:
        X_within = X_within.drop(columns=zero_var_cols)
    used_cols = list(X_within.columns)
    if not used_cols:
        return None

    model = Lasso(alpha=alpha, max_iter=5000)
    model.fit(X_within[used_cols], y_within)
    coef = pd.Series(model.coef_, index=used_cols)

    entity_means_y = train_df.groupby(id_col)[dependent_col].mean()
    X_col_means = train_df.groupby(id_col)[used_cols].mean()
    entity_fe = entity_means_y - X_col_means[used_cols].dot(coef)
    average_fe = float(entity_fe.mean())

    return {
        "coef": coef,
        "entity_fe": entity_fe.to_dict(),
        "average_fe": average_fe,
        "used_cols": used_cols,
        "zero_var_cols": zero_var_cols,
    }


def _predict_lasso_fold(test_df, dependent_col, id_col, fold_fit):
    """Predict level y for held-out rows: alpha_entity + X @ beta.
    Entities unseen during training fall back to the average fixed
    effect across training entities."""
    used_cols = fold_fit["used_cols"]
    test_df = test_df.dropna(subset=used_cols + [dependent_col, id_col])
    if test_df.empty:
        return None, None

    alphas = test_df[id_col].map(fold_fit["entity_fe"]).fillna(fold_fit["average_fe"])
    y_pred = alphas.values + test_df[used_cols].values @ fold_fit["coef"].values
    y_true = test_df[dependent_col].values
    return y_true, y_pred


def _fold_metrics(y_true, y_pred):
    mse = float(mean_squared_error(y_true, y_pred))
    return {
        "rmse": safe_round(np.sqrt(mse)),
        "mae": safe_round(mean_absolute_error(y_true, y_pred)),
        "r2": safe_round(r2_score(y_true, y_pred)),
        "n_test_rows": int(len(y_true)),
    }


def _run_lasso_cv_fold(train_df, test_df, dependent_col, X_cols, id_col, alpha):
    if test_df.empty:
        return None
    fold_fit = _fit_lasso_fold(train_df, dependent_col, X_cols, id_col, alpha)
    if fold_fit is None:
        return None
    y_true, y_pred = _predict_lasso_fold(test_df, dependent_col, id_col, fold_fit)
    if y_true is None:
        return None
    return _fold_metrics(y_true, y_pred)


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


def run_lasso_cross_validation(df, dependent_col, X_cols, id_col, time_col, alpha, cv_folds=3):
    """
    Same reasoning as the panel Ridge/Fixed Effects endpoints:
    Lasso-on-demeaned-data implicitly estimates an entity fixed
    effect, so it can't meaningfully predict for an entity it never
    trained on -- time-based walk-forward CV (train on earlier
    periods, predict later periods for the SAME entities) is
    preferred when a usable date_column exists. Entity-based
    GroupKFold is the fallback, using the average fixed effect for
    held-out entities as a necessarily weaker stand-in.
    """
    fold_metrics = []
    method = None

    if time_col and df[time_col].nunique() >= cv_folds + 1:
        method = "time_based_walk_forward"
        unique_times = np.array(sorted(df[time_col].unique()))
        splitter = TimeSeriesSplit(n_splits=cv_folds)
        for train_t_idx, test_t_idx in splitter.split(unique_times):
            train_times = set(unique_times[train_t_idx])
            test_times = set(unique_times[test_t_idx])
            train_df = df[df[time_col].isin(train_times)]
            test_df = df[df[time_col].isin(test_times)]
            result = _run_lasso_cv_fold(train_df, test_df, dependent_col, X_cols, id_col, alpha)
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
                result = _run_lasso_cv_fold(train_df, test_df, dependent_col, X_cols, id_col, alpha)
                if result:
                    fold_metrics.append(result)
        else:
            method = "skipped_insufficient_entities"

    return {
        "method": method,
        "folds_requested": cv_folds,
        "folds_used": len(fold_metrics),
        **(_aggregate_cv_metrics(fold_metrics) or {}),
    }


# ─────────────────────────────────────────
# MAIN HANDLER
# ─────────────────────────────────────────

async def run_lasso_panel(request):
    try:
        payload = await request.json()

        raw_data         = payload.get("data", [])
        categorical_cols = payload.get("categorical_variable", [])
        dependent_col    = payload.get("dependent_variable")
        independent_cols = payload.get("independent_variable", [])
        id_col           = payload.get("id_column")
        time_col         = payload.get("date_column", None)
        remove_outliers  = payload.get("outliers", False)
        alpha            = float(payload.get("alpha", 1.0))
        cv_folds         = int(payload.get("cv_folds", 3))

        # ── Validation ──
        if not raw_data:
            raise ValueError("No data provided")
        if not dependent_col:
            raise ValueError("Dependent variable is required")
        if not independent_cols:
            raise ValueError("Independent variables are required")
        if not id_col:
            raise ValueError("Entity ID column is required for panel Lasso")
        if cv_folds < 2:
            raise ValueError("cv_folds must be at least 2")

        if isinstance(remove_outliers, str):
            remove_outliers = remove_outliers.strip().lower() in ("yes", "true", "1")

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
            raise ValueError("Dataset too small for panel Lasso")

        n_entities = df[id_col].nunique()
        if n_entities < 2:
            raise ValueError(
                f"Panel Lasso requires at least 2 entities. "
                f"Found only 1 unique value in '{id_col}'. "
                f"Make sure id_column is 'ZipCode', not 'ID'."
            )

        entity_counts = df.groupby(id_col).size()
        if (entity_counts < 2).all():
            raise ValueError(
                "Each entity has only one observation. "
                "Panel Lasso needs multiple time periods per entity."
            )

        n_obs  = len(df)
        X_cols = list(X_raw.columns)

        # ── Cross-validation (leakage-free: each fold demeans using
        # only that fold's training rows) ──
        cross_validation = run_lasso_cross_validation(
            df, dependent_col, X_cols, id_col, time_col, alpha, cv_folds=cv_folds
        )

        # ── Full-sample within transformation (for the reportable model) ──
        all_cols  = [dependent_col] + X_cols
        grp_means = df.groupby(id_col)[all_cols].transform("mean")
        y_within  = df[dependent_col] - grp_means[dependent_col]
        X_within  = df[X_cols]        - grp_means[X_cols]

        zero_var_cols = [c for c in X_within.columns if X_within[c].abs().max() < 1e-10]
        if zero_var_cols:
            X_within = X_within.drop(columns=zero_var_cols)

        if X_within.shape[1] == 0:
            raise ValueError(
                "All independent variables are time-invariant within entities. "
                f"Dropped: {zero_var_cols}"
            )

        # ── Fit Lasso on the full within-transformed sample ──
        # Key difference from Ridge: Lasso can shrink coefficients exactly
        # to zero, effectively dropping variables from the model.
        model = Lasso(alpha=alpha, max_iter=5000)
        model.fit(X_within, y_within)
        fitted_within = model.predict(X_within)

        within_r2 = safe_round(r2_score(y_within, fitted_within))
        mse       = safe_round(mean_squared_error(y_within, fitted_within))
        mae       = safe_round(mean_absolute_error(y_within, fitted_within))

        # ── Coefficients ──
        coef_names   = X_within.columns.tolist()
        coef_vals    = model.coef_
        coefficients = {str(name): safe_round(c, 6) for name, c in zip(coef_names, coef_vals)}

        retained_vars = [name for name, c in zip(coef_names, coef_vals) if abs(c) > 1e-10]
        dropped_by_lasso = [name for name in coef_names if name not in retained_vars]

        # ── Post-Lasso cluster-robust SEs via OLS on RETAINED variables only ──
        # Unlike Ridge (which never zeros anything, so all variables get
        # post-hoc inference), Lasso has performed variable selection --
        # standard practice is post-selection OLS on only the variables
        # Lasso kept, not the full original set.
        robust_se       = {k: None for k in coef_names}
        robust_p_values = {k: None for k in coef_names}
        if retained_vars:
            try:
                X_sel      = sm.add_constant(X_within[retained_vars], has_constant="add")
                ols_mdl    = sm.OLS(y_within, X_sel).fit()
                ols_robust = ols_mdl.get_robustcov_results(
                    cov_type="cluster", groups=df[id_col].values
                )
                param_index = list(ols_mdl.params.index)
                for p, v in zip(param_index, ols_robust.bse):
                    if p in robust_se:
                        robust_se[p] = safe_round(v, 6)
                for p, v in zip(param_index, ols_robust.pvalues):
                    if p in robust_p_values:
                        robust_p_values[p] = safe_round(v, 6)
            except Exception as e:
                robust_se       = {"error": str(e)}
                robust_p_values = {"error": str(e)}

        # ── Entity fixed effects: alpha_i = mean(y_i) - mean(X_i) @ beta ──
        # Uses ALL coefficients (including zeros from Lasso), which is
        # correct: a dropped variable contributes 0 to the fixed effect,
        # it isn't simply omitted from the calculation.
        coef_series    = pd.Series({c: coefficients[c] for c in coef_names})
        entity_means_y = df.groupby(id_col)[dependent_col].mean()
        X_col_means    = df.groupby(id_col)[coef_names].mean()
        entity_fe = {
            str(ent): safe_round(v)
            for ent, v in (entity_means_y - X_col_means.dot(coef_series)).items()
        }

        return JSONResponse(content=sanitize({
            "success":        True,
            "model":          "LASSO PANEL",
            "n_entities":     n_entities,
            "n_observations": n_obs,
            "time_periods":   df[time_col].nunique() if time_col else None,
            "within_r2":      within_r2,
            "mse":            mse,
            "mae":            mae,
            "cross_validation": cross_validation,
            "lasso": {
                # Alpha is the regularization strength.
                # Higher alpha → more coefficients shrunk exactly to zero.
                # Lower alpha → approaches OLS, fewer variables dropped.
                "alpha":                  alpha,
                "n_total":                len(coef_names),
                "n_retained":             len(retained_vars),
                "retained":               retained_vars,
                "dropped_by_lasso":       dropped_by_lasso,
                "dropped_time_invariant": zero_var_cols if zero_var_cols else None,
            },
            "coefficients":            coefficients,
            "standard_errors":         {k: None for k in coef_names},
            "p_values":                {k: None for k in coef_names},
            "cluster_robust_se":       robust_se,
            "cluster_robust_p_values": robust_p_values,
            "entity_fixed_effects":    entity_fe,
        }))

    except Exception as e:
        return JSONResponse(
            content={
                "success": False,
                "error":   "Panel Lasso model execution failed",
                "details": str(e),
            },
            status_code=500,
        )