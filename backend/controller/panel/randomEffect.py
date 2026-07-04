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
# DIAGNOSTICS (identical format to FE)
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


def test_multicollinearity_panel(X_transformed):
    results = {}
    try:
        X_const = sm.add_constant(X_transformed, has_constant="add")
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

        corr_matrix = X_transformed.corr().round(4)
        results["correlation_matrix"] = {
            str(c): {str(r): safe_round(v, 4) for r, v in row.items()}
            for c, row in corr_matrix.to_dict().items()
        }

        high_corr_pairs = []
        cols = X_transformed.columns.tolist()
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
        resid_lagged = residuals_df.groupby(entity_col)["residual"].shift(1)
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

        cd_stat = math.sqrt(2 * T / (N * (N - 1))) * corr_sum
        p_value = 2 * (1 - stats.norm.cdf(abs(cd_stat)))
        p_val_r = safe_round(p_value)

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
# HAUSMAN TEST
# ─────────────────────────────────────────

def hausman_test(fe_params, re_params, fe_cov, re_cov, common_vars):
    """
    H0: RE is consistent (entity effects uncorrelated with X) → prefer RE.
    H1: Only FE is consistent → prefer FE.
    p < 0.05 → reject RE, use Fixed Effects.
    """
    try:
        b_fe   = np.array([fe_params[v] for v in common_vars])
        b_re   = np.array([re_params[v] for v in common_vars])
        fe_keys = list(fe_params.keys())
        re_keys = list(re_params.keys())
        idx_fe  = [fe_keys.index(v) for v in common_vars]
        idx_re  = [re_keys.index(v) for v in common_vars]
        V_fe    = fe_cov[np.ix_(idx_fe, idx_fe)]
        V_re    = re_cov[np.ix_(idx_re, idx_re)]
        V_diff  = V_fe - V_re
        diff    = b_fe - b_re

        V_inv  = np.linalg.pinv(V_diff)
        H_stat = float(diff @ V_inv @ diff)
        df_h   = len(common_vars)
        p_val  = float(1 - stats.chi2.cdf(H_stat, df_h))
        p_r    = safe_round(p_val)

        return {
            "statistic":      safe_round(H_stat),
            "df":             df_h,
            "p_value":        p_r,
            "interpretation": interpret_p(p_r),
            "conclusion": (
                "Reject RE — entity effects are correlated with regressors. Use Fixed Effects."
                if p_r is not None and p_r < 0.05
                else "Fail to reject RE — Random Effects is preferred (more efficient than FE)."
            ),
            "recommendation": "FIXED_EFFECTS" if (p_r is not None and p_r < 0.05) else "RANDOM_EFFECTS",
        }
    except Exception as e:
        return {"error": str(e)}


# ─────────────────────────────────────────
# VARIANCE COMPONENTS (Swamy-Arora)
# ─────────────────────────────────────────

def estimate_variance_components(df, y_col, X_cols, entity_col):
    """
    Vectorized Swamy-Arora variance component estimation.
    sigma2_e: within-entity (idiosyncratic) variance — from FE residuals
    sigma2_u: between-entity (random effect) variance — from between regression
    theta_i:  per-entity quasi-demeaning weight for RE transformation
    """
    n_obs      = len(df)
    n_entities = df[entity_col].nunique()
    k          = len(X_cols)

    # ── sigma2_e from FE residuals (vectorized demeaning) ──
    all_cols  = [y_col] + list(X_cols)
    grp_means = df.groupby(entity_col)[all_cols].transform("mean")
    y_within  = df[y_col]      - grp_means[y_col]
    X_within  = df[list(X_cols)] - grp_means[list(X_cols)]

    X_fe_c   = sm.add_constant(X_within, has_constant="add")
    fe_resid = sm.OLS(y_within, X_fe_c).fit().resid
    df_w     = n_obs - n_entities - k
    sigma2_e = float(np.sum(fe_resid ** 2) / df_w) if df_w > 0 else 1.0

    # ── sigma2_u from between (entity-mean) regression ──
    agg      = df.groupby(entity_col)[all_cols].mean().reset_index()
    T_i      = df.groupby(entity_col).size().values
    X_bet    = sm.add_constant(agg[list(X_cols)], has_constant="add")
    be_resid = sm.OLS(agg[y_col], X_bet).fit().resid
    df_bet   = n_entities - k - 1
    sigma2_u = max(
        float(np.sum(be_resid ** 2) / df_bet) - sigma2_e / float(np.mean(T_i))
        if df_bet > 0 else 0.0,
        0.0
    )

    # ── Per-entity theta (quasi-demeaning weight) ──
    entity_T   = df.groupby(entity_col).size()
    theta_dict = {
        ent: 1.0 - math.sqrt(sigma2_e / (T_ent * sigma2_u + sigma2_e))
        if (T_ent * sigma2_u + sigma2_e) > 0 else 0.0
        for ent, T_ent in entity_T.items()
    }
    theta_series = df[entity_col].map(theta_dict)

    return sigma2_e, sigma2_u, theta_series, theta_dict


# ─────────────────────────────────────────
# MAIN HANDLER
# ─────────────────────────────────────────

async def run_random_effects_prediction(request):
    try:
        payload = await request.json()

        raw_data         = payload.get("data", [])
        categorical_cols = payload.get("categorical_variable", [])
        dependent_col    = payload.get("dependent_variable")
        independent_cols = payload.get("independent_variable", [])
        id_col           = payload.get("id_column")
        time_col         = payload.get("date_column", None)
        remove_outliers  = payload.get("outliers", False)
        run_hausman      = payload.get("hausman_test", True)

        if not raw_data:
            raise ValueError("No data provided")
        if not dependent_col:
            raise ValueError("Dependent variable is required")
        if not independent_cols:
            raise ValueError("Independent variables are required")
        if not id_col:
            raise ValueError("Entity ID column is required for Random Effects")

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
            raise ValueError("Dataset too small for Random Effects estimation")

        n_entities    = df[id_col].nunique()
        if n_entities < 2:
            raise ValueError(
                f"Random Effects requires at least 2 entities. "
                f"Found only 1 unique value in '{id_col}'. "
                f"Make sure id_column is 'ZipCode', not 'ID'."
            )

        entity_counts = df.groupby(id_col).size()
        if (entity_counts < 2).all():
            raise ValueError(
                "Each entity has only one observation. Random Effects requires "
                "multiple time periods per entity."
            )

        n_obs  = len(df)
        X_cols = list(X_raw.columns)
        k      = len(X_cols)

        # ── Variance components (Swamy-Arora) ──
        sigma2_e, sigma2_u, theta_series, theta_dict = estimate_variance_components(
            df, dependent_col, X_cols, id_col
        )

        # ── RE quasi-demeaning (vectorized) ──
        # Subtract theta_i * entity_mean from y and each X
        # theta close to 1 → behaves like FE
        # theta close to 0 → behaves like pooled OLS
        all_cols      = [dependent_col] + X_cols
        grp_means     = df.groupby(id_col)[all_cols].transform("mean")
        theta_vals    = theta_series.values.reshape(-1, 1)

        y_re  = df[dependent_col].values - theta_series.values * grp_means[dependent_col].values
        X_re  = df[X_cols].values        - theta_vals           * grp_means[X_cols].values
        y_re  = pd.Series(y_re, index=df.index)
        X_re  = pd.DataFrame(X_re, columns=X_cols, index=df.index)
        X_re_c = sm.add_constant(X_re, has_constant="add")

        # ── Fit GLS (OLS on quasi-demeaned data) ──
        model         = sm.OLS(y_re, X_re_c).fit()
        residuals     = model.resid
        fitted_values = model.fittedvalues

        # ── Metrics ──
        ss_res     = np.sum((y_re.values - fitted_values.values) ** 2)
        ss_tot     = np.sum((y_re.values - y_re.values.mean()) ** 2)
        overall_r2 = safe_round(1 - ss_res / ss_tot if ss_tot != 0 else None)

        # Within R²
        entity_mean_y  = grp_means[dependent_col]
        y_within_orig  = df[dependent_col] - entity_mean_y
        fitted_within  = fitted_values - theta_series.values * entity_mean_y
        ss_res_w       = np.sum((y_within_orig.values - fitted_within.values) ** 2)
        ss_tot_w       = np.sum((y_within_orig.values - y_within_orig.values.mean()) ** 2)
        within_r2      = safe_round(1 - ss_res_w / ss_tot_w if ss_tot_w != 0 else None)

        n_obs              = len(df)
        df_resid_corrected = n_obs - n_entities - k
        mse                = safe_round(mean_squared_error(y_re, fitted_values))
        mae                = safe_round(mean_absolute_error(y_re, fitted_values))
        p_values           = {str(k_): safe_round(v, 6) for k_, v in model.pvalues.items()}
        standard_errors    = {str(k_): safe_round(v, 6) for k_, v in model.bse.items()}

        # ── Cluster-robust SE ──
        try:
            model_robust    = model.get_robustcov_results(
                cov_type="cluster", groups=df[id_col].values
            )
            param_index     = list(model.params.index)
            robust_se       = {str(p): safe_round(v, 6) for p, v in zip(param_index, model_robust.bse)}
            robust_p_values = {str(p): safe_round(v, 6) for p, v in zip(param_index, model_robust.pvalues)}
        except Exception as e:
            robust_se       = {"error": str(e)}
            robust_p_values = {"error": str(e)}

        # ── Residuals df for diagnostics ──
        resid_df = pd.DataFrame({
            "entity":   df[id_col].values,
            "time":     df[time_col].values if time_col else np.arange(n_obs),
            "residual": residuals.values,
        })

        # ── Diagnostics (identical format to FE) ──
        diagnostics = {
            "heteroskedasticity":         test_heteroskedasticity_panel(residuals, X_re_c),
            "multicollinearity":          test_multicollinearity_panel(X_re),
            "normality_of_residuals":     test_normality_panel(residuals),
            "serial_correlation":         test_serial_correlation_panel(resid_df, entity_col="entity", time_col="time"),
            "cross_sectional_dependence": test_cross_sectional_dependence(resid_df, entity_col="entity", time_col="time"),
        }

        # ── Hausman test ──
        hausman_result = None
        if run_hausman:
            try:
                # FE on same data for comparison (already have demeaned vars)
                all_cols_fe  = [dependent_col] + X_cols
                grp_means_fe = df.groupby(id_col)[all_cols_fe].transform("mean")
                y_fe         = df[dependent_col] - grp_means_fe[dependent_col]
                X_fe         = df[X_cols]        - grp_means_fe[X_cols]
                X_fe_c       = sm.add_constant(X_fe, has_constant="add")
                fe_model     = sm.OLS(y_fe, X_fe_c).fit()

                common_vars  = [v for v in X_cols if v in model.params and v in fe_model.params]
                hausman_result = hausman_test(
                    fe_params   = dict(fe_model.params),
                    re_params   = dict(model.params),
                    fe_cov      = fe_model.cov_params().values,
                    re_cov      = model.cov_params().values,
                    common_vars = common_vars,
                )
            except Exception as e:
                hausman_result = {"error": str(e)}

        # ── Entity random effects (BLUPs) ──
        entity_resid_mean = resid_df.groupby("entity")["residual"].mean()
        entity_re_blup    = {}
        for ent, e_bar in entity_resid_mean.items():
            T_ent                    = int(entity_counts.get(ent, 1))
            denom                    = sigma2_u + sigma2_e / T_ent
            blup                     = (sigma2_u / denom) * e_bar if denom > 0 else 0.0
            entity_re_blup[str(ent)] = safe_round(blup)

        response_payload = sanitize({
            "success":        True,
            "model":          "RANDOM EFFECTS",
            "n_entities":     n_entities,
            "n_observations": n_obs,
            "time_periods":   df[time_col].nunique() if time_col else None,
            "overall_r2":     overall_r2,
            "within_r2":      within_r2,
            "mse":            mse,
            "mae":            mae,
            "f_statistic":    safe_round(model.fvalue),
            "f_pvalue":       safe_round(model.f_pvalue),
            "aic":            safe_round(model.aic),
            "bic":            safe_round(model.bic),
            "df_resid_corrected": df_resid_corrected,
            "variance_components": {
                "sigma2_u":   safe_round(sigma2_u, 6),
                "sigma2_e":   safe_round(sigma2_e, 6),
                "rho":        safe_round(
                    sigma2_u / (sigma2_u + sigma2_e)
                    if (sigma2_u + sigma2_e) > 0 else None
                ),
                "theta_mean": safe_round(float(np.mean(list(theta_dict.values())))),
            },
            "coefficients":            {str(k_): safe_round(v, 6) for k_, v in model.params.items()},
            "standard_errors":         standard_errors,
            "p_values":                p_values,
            "cluster_robust_se":       robust_se,
            "cluster_robust_p_values": robust_p_values,
            "entity_random_effects":   entity_re_blup,
            "hausman_test":            hausman_result,
            "diagnostics":             diagnostics,
        })

        return JSONResponse(content=response_payload)

    except Exception as e:
        return JSONResponse(
            content={
                "success": False,
                "error":   "Random Effects model execution failed",
                "details": str(e),
            },
            status_code=500,
        )