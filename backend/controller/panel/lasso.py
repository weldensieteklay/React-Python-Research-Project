from sklearn.linear_model import Lasso
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

        # ── Validation ──
        if not raw_data:
            raise ValueError("No data provided")
        if not dependent_col:
            raise ValueError("Dependent variable is required")
        if not independent_cols:
            raise ValueError("Independent variables are required")
        if not id_col:
            raise ValueError("Entity ID column is required for panel Lasso")

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

        n_entities    = df[id_col].nunique()
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

        # ── Vectorized within transformation (one groupby for all columns) ──
        all_cols  = [dependent_col] + X_cols
        grp_means = df.groupby(id_col)[all_cols].transform("mean")
        y_within  = df[dependent_col] - grp_means[dependent_col]
        X_within  = df[X_cols]        - grp_means[X_cols]

        # Drop time-invariant columns (zero after demeaning)
        zero_var_cols = [c for c in X_within.columns if X_within[c].abs().max() < 1e-10]
        if zero_var_cols:
            X_within = X_within.drop(columns=zero_var_cols)

        if X_within.shape[1] == 0:
            raise ValueError(
                "All independent variables are time-invariant within entities. "
                f"Dropped: {zero_var_cols}"
            )

        # ── Train / test split (same as cross-sectional Lasso) ──
        X_train, X_test, y_train, y_test = train_test_split(
            X_within, y_within, test_size=0.2, random_state=42
        )

        # ── Fit Lasso (fixed alpha — no CV loop, same as cross-sectional) ──
        model = Lasso(alpha=alpha, max_iter=10000)
        model.fit(X_train, y_train)
        predictions = model.predict(X_test)

        # ── Metrics ──
        within_r2 = safe_round(r2_score(y_test, predictions))
        mse       = safe_round(mean_squared_error(y_test, predictions))
        mae       = safe_round(mean_absolute_error(y_test, predictions))

        # ── Coefficients and variable selection ──
        coef_names      = X_within.columns.tolist()
        coef_vals       = model.coef_
        selected_vars   = []
        eliminated_vars = []
        coefficients    = {}
        p_values        = {}
        standard_errors = {}

        for name, coef in zip(coef_names, coef_vals):
            coefficients[str(name)]    = safe_round(coef, 6)
            p_values[str(name)]        = None  # Lasso has no p-values
            standard_errors[str(name)] = None  # Lasso has no SEs
            if abs(coef) > 1e-10:
                selected_vars.append(str(name))
            else:
                eliminated_vars.append(str(name))

        # ── Cluster-robust SE via post-Lasso OLS on selected vars ──
        robust_se       = {}
        robust_p_values = {}
        if selected_vars:
            try:
                X_sel      = sm.add_constant(X_within[selected_vars], has_constant="add")
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

        # ── Entity fixed effects ──
        entity_fe = {
            str(ent): safe_round(df.loc[df[id_col] == ent, dependent_col].mean())
            for ent in df[id_col].unique()
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
            "lasso": {
                "alpha":        alpha,
                "n_total":      len(coef_names),
                "n_selected":   len(selected_vars),
                "n_eliminated": len(eliminated_vars),
                "selected":     selected_vars,
                "eliminated":   eliminated_vars,
                "dropped_time_invariant": zero_var_cols if zero_var_cols else None,
            },
            "coefficients":            coefficients,
            "standard_errors":         standard_errors,
            "p_values":                p_values,
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