from fastapi.responses import JSONResponse
from sklearn.metrics import mean_squared_error, mean_absolute_error
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
        # Sort first so shift(1) is truly the prior time period
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
        # pivot_table handles duplicate time values safely (unbalanced panels)
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
    Much faster than looping column by column.
    """
    all_cols  = [y_col] + list(X_cols)
    grp_means = df.groupby(entity_col)[all_cols].transform("mean")
    y_within  = df[y_col] - grp_means[y_col]
    X_within  = df[list(X_cols)] - grp_means[list(X_cols)]
    return y_within, X_within


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

        if not raw_data:
            raise ValueError("No data provided")
        if not dependent_col:
            raise ValueError("Dependent variable is required")
        if not independent_cols:
            raise ValueError("Independent variables are required")
        if not id_col:
            raise ValueError("Entity ID column is required for Fixed Effects")

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

        df[id_col] = raw_df_aligned[id_col].values
        if time_col and time_col in raw_df_aligned.columns:
            df[time_col] = raw_df_aligned[time_col].values
        else:
            time_col = None

        df = df.dropna()

        if len(df) < 5:
            raise ValueError("Dataset too small for Fixed Effects estimation")

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

        # ── Vectorized within transformation ──
        y_within, X_within = apply_within_transformation(
            df, dependent_col, X_cols, id_col
        )

        # Drop time-invariant columns (zero variance after demeaning)
        zero_var_cols = [
            c for c in X_within.columns
            if X_within[c].abs().max() < 1e-10
        ]
        if zero_var_cols:
            X_within = X_within.drop(columns=zero_var_cols)

        if X_within.shape[1] == 0:
            raise ValueError(
                "All independent variables are time-invariant within entities "
                "and were removed by the within transformation. "
                f"Dropped: {zero_var_cols}"
            )

        # ── Fit OLS on within-transformed data ──
        X_within_c = sm.add_constant(X_within, has_constant="add")
        model      = sm.OLS(y_within, X_within_c).fit()

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

        mse             = safe_round(mean_squared_error(y_within, fitted_values))
        mae             = safe_round(mean_absolute_error(y_within, fitted_values))
        p_values        = {str(k_): safe_round(v, 6) for k_, v in model.pvalues.items()}
        standard_errors = {str(k_): safe_round(v, 6) for k_, v in model.bse.items()}

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
        entity_means_y = df.groupby(id_col)[dependent_col].mean()
        X_col_means    = df.groupby(id_col)[list(X_within.columns)].mean()
        coef_series    = pd.Series({col: model.params.get(col, 0) for col in X_within.columns})
        entity_fe      = {
            str(k_): safe_round(v)
            for k_, v in (entity_means_y - X_col_means.dot(coef_series)).items()
        }

        response_payload = sanitize({
            "success":        True,
            "model":          "FIXED_EFFECTS",
            "n_entities":     n_entities,
            "n_observations": n_obs,
            "time_periods":   df[time_col].nunique() if time_col else None,
            "within_r2":      within_r2,
            "mse":            mse,
            "mae":            mae,
            "f_statistic":    safe_round(model.fvalue),
            "f_pvalue":       safe_round(model.f_pvalue),
            "aic":            safe_round(model.aic),
            "bic":            safe_round(model.bic),
            "df_resid_corrected":              df_resid_corrected,
            "dropped_time_invariant_variables": zero_var_cols if zero_var_cols else None,
            "coefficients":            {str(k_): safe_round(v, 6) for k_, v in model.params.items()},
            "standard_errors":         standard_errors,
            "p_values":                p_values,
            "cluster_robust_se":       robust_se,
            "cluster_robust_p_values": robust_p_values,
            "entity_fixed_effects":    entity_fe,
            "diagnostics":             diagnostics,
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