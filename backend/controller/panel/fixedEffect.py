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
# HELPERS (reused from OLS)
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
# PANEL-SPECIFIC DIAGNOSTIC TESTS
# ─────────────────────────────────────────

def test_heteroskedasticity_panel(residuals, X_with_const):
    """
    Breusch-Pagan and White tests on within-transformed residuals.
    """
    results = {}
    try:
        bp_lm, bp_p, bp_f, bp_fp = het_breuschpagan(residuals, X_with_const)
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
        w_lm, w_p, w_f, w_fp = het_white(residuals, X_with_const)
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
    """
    VIF on within-transformed X (demeaned).
    """
    results = {}
    try:
        X_const = sm.add_constant(X_within, has_constant="add")
        vif_data = {}
        for i, col in enumerate(X_const.columns):
            if col == "const":
                continue
            vif = variance_inflation_factor(X_const.values, i)
            vif_r = safe_round(vif, 4)
            vif_data[str(col)] = {
                "vif": vif_r,
                "conclusion": (
                    "Severe multicollinearity" if (vif_r is not None and vif_r > 10)
                    else "Moderate multicollinearity" if (vif_r is not None and vif_r > 5)
                    else "Acceptable"
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


def test_serial_correlation_panel(residuals_df, entity_col="entity"):
    """
    Wooldridge-style serial correlation test for panel data.
    Tests whether residuals of adjacent time periods within the same
    entity are correlated. We use a simple AR(1) regression of
    residual[t] on residual[t-1] within each entity.
    H0: No serial correlation (coeff ~ 0).
    """
    try:
        resid_lagged = (
            residuals_df
            .groupby(entity_col)["residual"]
            .apply(lambda x: x.shift(1))
            .reset_index(level=0, drop=True)
        )
        df_ar = pd.DataFrame({
            "resid": residuals_df["residual"],
            "resid_lag": resid_lagged,
        }).dropna()

        if len(df_ar) < 10:
            return {"error": "Not enough observations for serial correlation test."}

        X_ar = sm.add_constant(df_ar["resid_lag"])
        ar_model = sm.OLS(df_ar["resid"], X_ar).fit()
        coef = safe_round(ar_model.params.get("resid_lag", ar_model.params.iloc[-1]), 6)
        p = safe_round(ar_model.pvalues.iloc[-1], 6)

        return {
            "ar1_coefficient": coef,
            "p_value": p,
            "interpretation": interpret_p(p),
            "conclusion": (
                "Serial correlation detected — consider clustered standard errors or GLS."
                if p is not None and p < 0.05
                else "No significant serial correlation detected."
            ),
        }
    except Exception as e:
        return {"error": str(e)}


def test_cross_sectional_dependence(residuals_df, entity_col="entity", time_col="time"):
    """
    Pesaran CD test for cross-sectional dependence in panel residuals.
    CD = sqrt(2T / N(N-1)) * sum_i sum_j>i corr(e_i, e_j)
    H0: No cross-sectional dependence.
    Large |CD| -> cross-sectional dependence present.
    """
    try:
        pivot = residuals_df.pivot(index=time_col, columns=entity_col, values="residual")
        pivot = pivot.dropna(axis=1, how="all")
        entities = pivot.columns.tolist()
        N = len(entities)
        T = len(pivot)

        if N < 2:
            return {"error": "Need at least 2 entities for CD test."}

        corr_sum = 0.0
        pairs = 0
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
                    pairs += 1

        if pairs == 0:
            return {"error": "Could not compute correlations between entities."}

        cd_stat = math.sqrt(2 * T / (N * (N - 1))) * corr_sum
        # Approximate p-value: CD ~ N(0,1) under H0
        p_value = 2 * (1 - stats.norm.cdf(abs(cd_stat)))

        p_value_r = safe_round(p_value)
        return {
            "cd_statistic": safe_round(cd_stat),
            "p_value": p_value_r,
            "n_entities": N,
            "t_periods": T,
            "interpretation": interpret_p(p_value_r),
            "conclusion": (
                "Cross-sectional dependence detected — consider Driscoll-Kraay or clustered SE."
                if p_value_r is not None and p_value_r < 0.05
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
            "statistic": safe_round(jb_stat),
            "p_value": jb_p_r,
            "skewness": safe_round(jb_skew),
            "kurtosis": safe_round(jb_kurt),
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


def test_within_r2(y_within, y_within_fitted):
    """
    Within R^2 - how well the model explains variation
    after removing entity fixed effects.
    """
    try:
        ss_res = np.sum((y_within - y_within_fitted) ** 2)
        ss_tot = np.sum((y_within - y_within.mean()) ** 2)
        within_r2 = 1 - ss_res / ss_tot if ss_tot != 0 else None
        return safe_round(within_r2)
    except Exception:
        return None


# ─────────────────────────────────────────
# WITHIN TRANSFORMATION (entity demeaning)
# ─────────────────────────────────────────

def apply_within_transformation(df, y_col, X_cols, entity_col):
    """
    Subtract entity means from y and each X column.
    This removes unobserved entity fixed effects.
    Returns demeaned y and X as Series/DataFrame.
    """
    df = df.copy()
    entity_means_y = df.groupby(entity_col)[y_col].transform("mean")
    df["y_within"] = df[y_col] - entity_means_y

    for col in X_cols:
        entity_mean_x = df.groupby(entity_col)[col].transform("mean")
        df[f"{col}_within"] = df[col] - entity_mean_x

    X_within_cols = [f"{col}_within" for col in X_cols]
    return df["y_within"], df[X_within_cols].rename(
        columns={f"{col}_within": col for col in X_cols}
    )


# ─────────────────────────────────────────
# MAIN HANDLER
# ─────────────────────────────────────────

async def run_fixed_effects_prediction(request):
    try:
        payload = await request.json()

        raw_data = payload.get("data", [])
        categorical_cols = payload.get("categorical_variable", [])
        dependent_col = payload.get("dependent_variable")
        independent_cols = payload.get("independent_variable", [])
        id_col = payload.get("id_column")            # entity identifier (e.g. ZIP code)
        time_col = payload.get("date_column", None)  # time identifier (e.g. year, month, date)
        remove_outliers = payload.get("outliers", False)

        if not raw_data:
            raise ValueError("No data provided")
        if not dependent_col:
            raise ValueError("Dependent variable is required")
        if not independent_cols:
            raise ValueError("Independent variables are required")
        if not id_col:
            raise ValueError("Entity ID column is required for Fixed Effects")

        # ── Guard: entity/time columns should not be used as regressors ──
        # Including the entity ID as a regressor is collinear with the
        # entity fixed effects (it becomes exactly 0 after within-demeaning).
        independent_cols = [c for c in independent_cols if c != id_col]
        if time_col:
            independent_cols = [c for c in independent_cols if c != time_col]
        if not independent_cols:
            raise ValueError(
                "Independent variables are required (excluding id/time columns)"
            )

        # ── Prepare base dataset ──
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

        # Rebuild full df with entity column for panel structure.
        # X_raw/y_raw keep the original row index from prepare_dataset's
        # internal dataframe (dropna/outlier filtering only removes rows,
        # it does not reset the index) - so we can align raw_data to it.
        df = X_raw.copy()
        df[dependent_col] = y_raw.values

        raw_df = pd.DataFrame(raw_data)

        if len(raw_df) != len(df):
            # prepare_dataset filtered out rows (dropna / outlier removal) -
            # align by the surviving index instead of assuming same length.
            missing_idx = df.index.difference(raw_df.index)
            if len(missing_idx) > 0:
                raise ValueError(
                    "Could not align entity/time columns with prepared dataset "
                    "(index mismatch after filtering)."
                )
            raw_df_aligned = raw_df.loc[df.index]
        else:
            raw_df_aligned = raw_df

        if id_col not in raw_df_aligned.columns:
            raise ValueError(f"id_column '{id_col}' not found in input data")
        df[id_col] = raw_df_aligned[id_col].values

        if time_col and time_col in raw_df_aligned.columns:
            df[time_col] = raw_df_aligned[time_col].values
        else:
            time_col = None

        # Drop rows with any remaining NaN (e.g. coercion failures)
        df = df.dropna()

        if len(df) < 5:
            raise ValueError("Dataset too small for Fixed Effects estimation")

        n_entities = df[id_col].nunique()
        if n_entities < 2:
            raise ValueError("Fixed Effects requires at least 2 entities")

        # Need within-entity variation to estimate anything
        entity_counts = df.groupby(id_col).size()
        if (entity_counts < 2).all():
            raise ValueError(
                "Each entity has only one observation - Fixed Effects requires "
                "panel data with multiple time periods per entity."
            )

        # ── Within transformation (entity demeaning) ──
        y_within, X_within = apply_within_transformation(
            df, dependent_col, list(X_raw.columns), id_col
        )

        # Drop columns that became all-zero after demeaning (time-invariant
        # regressors are not identifiable in a fixed-effects model)
        zero_var_cols = [c for c in X_within.columns if np.allclose(X_within[c], 0)]
        if zero_var_cols:
            X_within = X_within.drop(columns=zero_var_cols)

        if X_within.shape[1] == 0:
            raise ValueError(
                "All independent variables are time-invariant within entities "
                "and were removed by the within transformation. "
                "Fixed Effects cannot estimate their coefficients."
            )

        # ── Fit OLS on within-transformed data ──
        X_within_c = sm.add_constant(X_within, has_constant="add")
        model = sm.OLS(y_within, X_within_c).fit()

        residuals = model.resid
        fitted_values = model.fittedvalues

        # ── Degrees of freedom correction for FE ──
        # FE uses N-1 additional df for entity dummies
        n_obs = len(df)
        k = X_within.shape[1]
        df_resid_corrected = n_obs - n_entities - k

        # ── Cluster-robust SE (clustered by entity) ──
        try:
            groups = df[id_col].values
            model_robust = model.get_robustcov_results(
                cov_type="cluster", groups=groups
            )
            param_index = list(model.params.index)
            robust_se = {
                str(k_): safe_round(v, 6)
                for k_, v in zip(param_index, model_robust.bse)
            }
            robust_p_values = {
                str(k_): safe_round(v, 6)
                for k_, v in zip(param_index, model_robust.pvalues)
            }
        except Exception as e:
            robust_se = {"error": str(e)}
            robust_p_values = {"error": str(e)}

        # ── Core metrics ──
        within_r2 = test_within_r2(y_within.values, fitted_values.values)
        mse = safe_round(mean_squared_error(y_within, fitted_values))
        mae = safe_round(mean_absolute_error(y_within, fitted_values))

        p_values = {str(k_): safe_round(v, 6) for k_, v in model.pvalues.items()}
        standard_errors = {str(k_): safe_round(v, 6) for k_, v in model.bse.items()}

        # ── Build residuals df for panel diagnostics ──
        resid_df = pd.DataFrame({
            "entity": df[id_col].values,
            "time": df[time_col].values if time_col else range(len(df)),
            "residual": residuals.values,
        })

        # ── Diagnostics ──
        diagnostics = {
            "heteroskedasticity": test_heteroskedasticity_panel(residuals, X_within_c),
            "multicollinearity": test_multicollinearity_panel(X_within),
            "normality_of_residuals": test_normality_panel(residuals),
            "serial_correlation": test_serial_correlation_panel(resid_df, entity_col="entity"),
            "cross_sectional_dependence": test_cross_sectional_dependence(
                resid_df, entity_col="entity", time_col="time"
            ),
        }

        # ── Entity fixed effects (intercepts per entity) ──
        entity_means_y = df.groupby(id_col)[dependent_col].mean()
        X_col_means = df.groupby(id_col)[list(X_within.columns)].mean()
        coef_series = pd.Series(
            {col: model.params.get(col, 0) for col in X_within.columns}
        )
        entity_fe = (entity_means_y - X_col_means.dot(coef_series)).to_dict()
        entity_fe = {str(k_): v for k_, v in entity_fe.items()}

        if zero_var_cols:
            dropped_note = (
                f"The following variables were dropped because they do not vary "
                f"within entities (time-invariant) and are not identifiable under "
                f"Fixed Effects: {zero_var_cols}"
            )
        else:
            dropped_note = None

        response_payload = sanitize({
            "success": True,
            "model": "FIXED_EFFECTS",
            "n_entities": n_entities,
            "n_observations": n_obs,
            "time_periods": df[time_col].nunique() if time_col else None,
            "within_r2": within_r2,
            "mse": mse,
            "mae": mae,
            "f_statistic": safe_round(model.fvalue),
            "f_pvalue": safe_round(model.f_pvalue),
            "aic": safe_round(model.aic),
            "bic": safe_round(model.bic),
            "df_resid_corrected": df_resid_corrected,
            "dropped_time_invariant_variables": zero_var_cols if zero_var_cols else None,
            "note": dropped_note,
            "coefficients": {
                str(k_): safe_round(v, 6) for k_, v in model.params.items()
            },
            "standard_errors": standard_errors,
            "p_values": p_values,
            "cluster_robust_se": robust_se,
            "cluster_robust_p_values": robust_p_values,
            "entity_fixed_effects": entity_fe,
            "diagnostics": diagnostics,
        })

        return JSONResponse(content=response_payload)

    except Exception as e:
        return JSONResponse(
            content={
                "success": False,
                "error": "Fixed Effects model execution failed",
                "details": str(e),
            },
            status_code=500,
        )