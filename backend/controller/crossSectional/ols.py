from fastapi.responses import JSONResponse
from sklearn.model_selection import train_test_split
from sklearn.metrics import r2_score, mean_squared_error, mean_absolute_error
import statsmodels.api as sm
from statsmodels.stats.stattools import durbin_watson
from statsmodels.stats.outliers_influence import variance_inflation_factor
from statsmodels.stats.diagnostic import het_breuschpagan, het_white, linear_reset
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
    """
    Recursively walk any dict/list/value and replace
    nan, inf, -inf, and numpy scalars with JSON-safe types.
    This is the single source of truth — applied to the
    entire response payload before JSONResponse is called.
    """
    if isinstance(obj, dict):
        return {k: sanitize(v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [sanitize(v) for v in obj]
    if isinstance(obj, float):
        if math.isnan(obj) or math.isinf(obj):
            return None
        return obj
    # numpy scalar types
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
# DIAGNOSTIC TESTS
# ─────────────────────────────────────────

def test_heteroskedasticity(residuals, X_with_const):
    results = {}
    try:
        bp_lm, bp_p, bp_f, bp_fp = het_breuschpagan(residuals, X_with_const)
        results["breusch_pagan"] = {
            "lm_statistic": safe_round(bp_lm),
            "p_value": safe_round(bp_p),
            "interpretation": interpret_p(safe_round(bp_p)),
            "conclusion": (
                "Heteroskedasticity detected — consider robust standard errors."
                if bp_p < 0.05
                else "No significant heteroskedasticity detected."
            ),
        }
    except Exception as e:
        results["breusch_pagan"] = {"error": str(e)}

    try:
        w_lm, w_p, w_f, w_fp = het_white(residuals, X_with_const)
        results["white_test"] = {
            "lm_statistic": safe_round(w_lm),
            "p_value": safe_round(w_p),
            "interpretation": interpret_p(safe_round(w_p)),
            "conclusion": (
                "Heteroskedasticity detected — consider robust standard errors."
                if w_p < 0.05
                else "No significant heteroskedasticity detected."
            ),
        }
    except Exception as e:
        results["white_test"] = {"error": str(e)}

    return results


def test_multicollinearity(X):
    results = {}
    try:
        X_const = sm.add_constant(X, has_constant="add")
        vif_data = {}
        for i, col in enumerate(X_const.columns):
            if col == "const":
                continue
            vif = variance_inflation_factor(X_const.values, i)
            vif_data[str(col)] = {
                "vif": safe_round(vif, 4),
                "conclusion": (
                    "Severe multicollinearity" if vif > 10
                    else "Moderate multicollinearity" if vif > 5
                    else "Acceptable"
                ),
            }
        results["vif"] = vif_data

        corr_matrix = X.corr().round(4)
        # Convert to plain Python floats — corr() can produce numpy floats
        results["correlation_matrix"] = {
            str(c): {str(r): safe_round(v, 4) for r, v in row.items()}
            for c, row in corr_matrix.to_dict().items()
        }

        high_corr_pairs = []
        cols = X.columns.tolist()
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


def test_normality(residuals):
    results = {}
    try:
        jb_stat, jb_p, jb_skew, jb_kurt = jarque_bera(residuals)
        results["jarque_bera"] = {
            "statistic": safe_round(jb_stat),
            "p_value": safe_round(jb_p),
            "skewness": safe_round(jb_skew),
            "kurtosis": safe_round(jb_kurt),
            "interpretation": interpret_p(safe_round(jb_p)),
            "conclusion": (
                "Residuals are not normally distributed — inference may be unreliable in small samples."
                if jb_p < 0.05
                else "Residuals appear normally distributed."
            ),
        }
    except Exception as e:
        results["jarque_bera"] = {"error": str(e)}

    try:
        sample = (
            residuals if len(residuals) <= 5000
            else pd.Series(residuals).sample(5000, random_state=42)
        )
        sw_stat, sw_p = stats.shapiro(sample)
        results["shapiro_wilk"] = {
            "statistic": safe_round(sw_stat),
            "p_value": safe_round(sw_p),
            "interpretation": interpret_p(safe_round(sw_p)),
            "conclusion": (
                "Residuals deviate from normality."
                if sw_p < 0.05
                else "Residuals appear normally distributed."
            ),
        }
    except Exception as e:
        results["shapiro_wilk"] = {"error": str(e)}

    return results


def test_autocorrelation(residuals):
    try:
        dw = durbin_watson(residuals)
        if dw < 1.5:
            conclusion = "Positive autocorrelation detected."
        elif dw > 2.5:
            conclusion = "Negative autocorrelation detected."
        else:
            conclusion = "No significant autocorrelation detected."
        return {
            "durbin_watson_statistic": safe_round(dw),
            "conclusion": conclusion,
        }
    except Exception as e:
        return {"error": str(e)}


def test_model_specification(model, X_with_const, y):
    try:
        reset = linear_reset(model, power=3, use_f=True)
        p = safe_round(reset.pvalue)
        return {
            "f_statistic": safe_round(reset.statistic),
            "p_value": p,
            "interpretation": interpret_p(p),
            "conclusion": (
                "Model may be misspecified — consider adding variables or transforming predictors."
                if p is not None and p < 0.05
                else "No significant misspecification detected."
            ),
        }
    except Exception as e:
        return {"error": str(e)}


def test_influential_observations(model, X_with_const):
    try:
        influence = model.get_influence()
        cooks_d, _ = influence.cooks_distance
        n = len(cooks_d)
        threshold = 4 / n
        influential_idx = np.where(cooks_d > threshold)[0].tolist()
        return {
            "threshold": safe_round(threshold, 6),
            "n_influential": len(influential_idx),
            "influential_indices": influential_idx[:20],
            "max_cooks_d": safe_round(float(np.nanmax(cooks_d))),
            "conclusion": (
                f"{len(influential_idx)} influential observation(s) detected (Cook's D > {round(threshold, 4)})."
                if influential_idx
                else "No influential observations detected."
            ),
        }
    except Exception as e:
        return {"error": str(e)}


def test_linearity(residuals, y_fitted):
    try:
        corr, p = stats.pearsonr(y_fitted, residuals)
        return {
            "correlation_fitted_vs_residuals": safe_round(corr),
            "p_value": safe_round(p),
            "conclusion": (
                "Potential non-linearity detected — residuals correlate with fitted values."
                if abs(corr) > 0.1 and p < 0.05
                else "Linearity assumption appears satisfied."
            ),
        }
    except Exception as e:
        return {"error": str(e)}


# ─────────────────────────────────────────
# MAIN HANDLER
# ─────────────────────────────────────────

async def run_ols_prediction(request):
    try:
        payload = await request.json()

        raw_data = payload.get("data", [])
        categorical_cols = payload.get("categorical_variable", [])
        dependent_col = payload.get("dependent_variable")
        independent_cols = payload.get("independent_variable", [])
        id_col = payload.get("id_column")
        remove_outliers = payload.get("outliers", False)

        if not raw_data:
            raise ValueError("No data provided")
        if not dependent_col:
            raise ValueError("Dependent variable is required")
        if not independent_cols:
            raise ValueError("Independent variables are required")

        prepared = prepare_dataset(
            raw_data=raw_data,
            dependent_col=dependent_col,
            independent_cols=independent_cols,
            categorical_cols=categorical_cols,
            id_col=id_col,
            remove_outliers=remove_outliers,
        )

        X = prepared["X"].copy().apply(pd.to_numeric, errors="coerce")
        y = pd.to_numeric(prepared["y"].copy(), errors="coerce")

        valid_rows = X.notna().all(axis=1) & y.notna()
        X, y = X[valid_rows], y[valid_rows]

        if len(X) < 5:
            raise ValueError("Dataset too small for OLS")

        X_train, X_test, y_train, y_test = train_test_split(
            X, y, test_size=0.2, random_state=42
        )

        X_train_c = sm.add_constant(X_train, has_constant="add")
        X_test_c = sm.add_constant(X_test, has_constant="add")

        model = sm.OLS(y_train, X_train_c).fit()
        predictions = model.predict(X_test_c)

        residuals = model.resid
        fitted_values = model.fittedvalues
        r2 = r2_score(y_test, predictions)
        mse = mean_squared_error(y_test, predictions)
        mae = mean_absolute_error(y_test, predictions)

        p_values = {str(k): safe_round(v, 6) for k, v in model.pvalues.items()}
        standard_errors = {str(k): safe_round(v, 6) for k, v in model.bse.items()}

        # ── Robust model (HC3) ──
        param_index = list(model.params.index)
        model_robust = model.get_robustcov_results(cov_type="HC3")
        robust_se = {
            str(k): safe_round(v, 6)
            for k, v in zip(param_index, model_robust.bse)
        }
        robust_p_values = {
            str(k): safe_round(v, 6)
            for k, v in zip(param_index, model_robust.pvalues)
        }

        # ── Diagnostics ──
        diagnostics = {
            "heteroskedasticity": test_heteroskedasticity(residuals, X_train_c),
            "multicollinearity": test_multicollinearity(X_train),
            "normality_of_residuals": test_normality(residuals),
            "autocorrelation": test_autocorrelation(residuals),
            "model_specification": test_model_specification(model, X_train_c, y_train),
            "influential_observations": test_influential_observations(model, X_train_c),
            "linearity": test_linearity(residuals, fitted_values),
        }

        # ── Build full payload and sanitize in one pass ──
        response_payload = sanitize({
            "success": True,
            "model": "OLS",
            "rows_used": len(X),
            "r2_score": safe_round(r2),
            "adj_r2": safe_round(model.rsquared_adj),
            "mse": safe_round(mse),
            "mae": safe_round(mae),
            "f_statistic": safe_round(model.fvalue),
            "f_pvalue": safe_round(model.f_pvalue),
            "aic": safe_round(model.aic),
            "bic": safe_round(model.bic),
            "coefficients": {
                str(k): safe_round(v, 6) for k, v in model.params.items()
            },
            "standard_errors": standard_errors,
            "p_values": p_values,
            "robust_standard_errors_hc3": robust_se,
            "robust_p_values_hc3": robust_p_values,
            "diagnostics": diagnostics,
        })

        return JSONResponse(content=response_payload)

    except Exception as e:
        return JSONResponse(
            content={
                "success": False,
                "error": "Model execution failed",
                "details": str(e),
            },
            status_code=500,
        )