from sklearn.linear_model import Ridge
from sklearn.metrics import r2_score, mean_squared_error, mean_absolute_error
from fastapi.responses import JSONResponse
from sklearn.model_selection import train_test_split
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


async def run_ridge_panel(request):
    try:
        payload = await request.json()

        raw_data         = payload.get("data", [])
        categorical_cols = payload.get("categorical_variable", [])
        dependent_col    = payload.get("dependent_variable")
        independent_cols = payload.get("independent_variable", [])
        id_col           = payload.get("id_column")
        time_col         = payload.get("date_column", None)
        remove_outliers  = payload.get("outliers", False)
        # Ridge uses 'alpha' as its regularization strength (same param name as sklearn)
        alpha            = float(payload.get("alpha", 1.0))

        # ── Validation ──
        if not raw_data:
            raise ValueError("No data provided")
        if not dependent_col:
            raise ValueError("Dependent variable is required")
        if not independent_cols:
            raise ValueError("Independent variables are required")
        if not id_col:
            raise ValueError("Entity ID column is required for panel Ridge")

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
            raise ValueError("Dataset too small for panel Ridge")

        n_entities = df[id_col].nunique()
        if n_entities < 2:
            raise ValueError(
                f"Panel Ridge requires at least 2 entities. "
                f"Found only 1 unique value in '{id_col}'. "
                f"Make sure id_column is 'ZipCode', not 'ID'."
            )

        entity_counts = df.groupby(id_col).size()
        if (entity_counts < 2).all():
            raise ValueError(
                "Each entity has only one observation. "
                "Panel Ridge needs multiple time periods per entity."
            )

        n_obs  = len(df)
        X_cols = list(X_raw.columns)

        # ── Vectorized within transformation (demean by entity) ──
        all_cols  = [dependent_col] + X_cols
        grp_means = df.groupby(id_col)[all_cols].transform("mean")
        y_within  = df[dependent_col] - grp_means[dependent_col]
        X_within  = df[X_cols]        - grp_means[X_cols]

        # Drop time-invariant columns (zero variance after demeaning)
        zero_var_cols = [c for c in X_within.columns if X_within[c].abs().max() < 1e-10]
        if zero_var_cols:
            X_within = X_within.drop(columns=zero_var_cols)

        if X_within.shape[1] == 0:
            raise ValueError(
                "All independent variables are time-invariant within entities. "
                f"Dropped: {zero_var_cols}"
            )

        # ── Train / test split ──
        X_train, X_test, y_train, y_test = train_test_split(
            X_within, y_within, test_size=0.2, random_state=42
        )

        # ── Fit Ridge ──
        # Key difference from Lasso: Ridge shrinks all coefficients toward zero
        # but never sets them exactly to zero — no variable elimination occurs.
        model = Ridge(alpha=alpha)
        model.fit(X_train, y_train)
        predictions = model.predict(X_test)

        # ── Metrics ──
        within_r2 = safe_round(r2_score(y_test, predictions))
        mse       = safe_round(mean_squared_error(y_test, predictions))
        mae       = safe_round(mean_absolute_error(y_test, predictions))

        # ── Coefficients ──
        # Ridge retains all variables (no elimination), so we report all coefs.
        coef_names   = X_within.columns.tolist()
        coef_vals    = model.coef_
        coefficients = {}

        for name, coef in zip(coef_names, coef_vals):
            coefficients[str(name)] = safe_round(coef, 6)

        # ── Post-Ridge cluster-robust SEs via OLS on ALL selected variables ──
        # Ridge has no analytic p-values; we use post-Ridge OLS with cluster-robust
        # SEs to provide inference, same pattern as the Lasso implementation.
        robust_se       = {}
        robust_p_values = {}
        try:
            X_sel      = sm.add_constant(X_within[coef_names], has_constant="add")
            ols_mdl    = sm.OLS(y_within, X_sel).fit()
            ols_robust = ols_mdl.get_robustcov_results(
                cov_type="cluster", groups=df[id_col].values
            )
            param_index     = list(ols_mdl.params.index)
            robust_se       = {str(p): safe_round(v, 6) for p, v in zip(param_index, ols_robust.bse)}
            robust_p_values = {str(p): safe_round(v, 6) for p, v in zip(param_index, ols_robust.pvalues)}
        except Exception as e:
            robust_se       = {"error": str(e)}
            robust_p_values = {"error": str(e)}

        # ── Entity fixed effects (entity-level mean of dependent variable) ──
        entity_fe = {
            str(ent): safe_round(df.loc[df[id_col] == ent, dependent_col].mean())
            for ent in df[id_col].unique()
        }

        return JSONResponse(content=sanitize({
            "success":        True,
            "model":          "RIDGE PANEL",
            "n_entities":     n_entities,
            "n_observations": n_obs,
            "time_periods":   df[time_col].nunique() if time_col else None,
            "within_r2":      within_r2,
            "mse":            mse,
            "mae":            mae,
            "ridge": {
                # Alpha is the regularization strength.
                # Higher alpha → stronger shrinkage → coefficients closer to zero.
                # Lower alpha → weaker shrinkage → approaches OLS.
                "alpha":                  alpha,
                "n_total":                len(coef_names),
                # Ridge keeps ALL variables (no hard zeroing like Lasso).
                "n_retained":             len(coef_names),
                "retained":               coef_names,
                "dropped_time_invariant": zero_var_cols if zero_var_cols else None,
            },
            # Ridge coefficients (all shrunk, none eliminated)
            "coefficients":            coefficients,
            # Ridge has no analytic SEs or p-values; use cluster_robust_* below.
            "standard_errors":         {k: None for k in coef_names},
            "p_values":                {k: None for k in coef_names},
            # Post-Ridge OLS inference with cluster-robust SEs
            "cluster_robust_se":       robust_se,
            "cluster_robust_p_values": robust_p_values,
            "entity_fixed_effects":    entity_fe,
        }))

    except Exception as e:
        return JSONResponse(
            content={
                "success": False,
                "error":   "Panel Ridge model execution failed",
                "details": str(e),
            },
            status_code=500,
        )