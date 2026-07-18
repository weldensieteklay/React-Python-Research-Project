from fastapi.responses import JSONResponse
from sklearn.model_selection import train_test_split, KFold
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

# Number of folds for the supplementary cross-validation robustness check.
# This is NOT a hyperparameter-selection CV (plain OLS has no
# regularization strength to tune) — it exists purely to report how
# stable the model's out-of-sample performance is across different
# train/validation partitions, as a complement to the single fixed
# 80/20 split used for the primary reported metrics.
CV_FOLDS = 5


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
# SUPPLEMENTARY K-FOLD CROSS-VALIDATION
# ─────────────────────────────────────────

def run_kfold_cv(X, y, k=CV_FOLDS, random_state=42):
    """
    Refits OLS across k different train/validation partitions of the full
    dataset and reports the spread of out-of-sample R^2/RMSE/MAE. This is
    a robustness check on the single-split test metrics, not a
    replacement for them — plain OLS has no hyperparameter for CV to
    select, so this exists purely to show whether the reported test
    performance is a stable estimate or sensitive to which rows happened
    to land in the held-out set.

    Returns a dict with per-fold results and mean/std, or an "error" key
    if the dataset is too small for meaningful folds (each fold's training
    partition must have more rows than parameters, or the fit is
    underdetermined and unreliable).
    """
    n_params = X.shape[1] + 1  # +1 for intercept
    min_rows_needed = k * max(5, n_params + 1)
    if len(X) < min_rows_needed:
        return {
            "error": (
                f"Dataset too small for {k}-fold cross-validation given "
                f"{n_params} parameters (need at least {min_rows_needed} rows, "
                f"have {len(X)}). Reduce the number of independent/categorical "
                f"variables, or treat this section as unavailable for this run."
            )
        }

    kf = KFold(n_splits=k, shuffle=True, random_state=random_state)
    X_reset = X.reset_index(drop=True)
    y_reset = y.reset_index(drop=True)

    fold_results = []
    fold_r2, fold_rmse, fold_mae = [], [], []

    for fold_idx, (train_idx, val_idx) in enumerate(kf.split(X_reset), start=1):
        X_tr, X_val = X_reset.iloc[train_idx], X_reset.iloc[val_idx]
        y_tr, y_val = y_reset.iloc[train_idx], y_reset.iloc[val_idx]

        if len(X_tr) <= n_params:
            return {
                "error": (
                    f"Fold {fold_idx} has only {len(X_tr)} training rows for "
                    f"{n_params} parameters — underdetermined. Reduce the "
                    f"number of variables or use fewer folds."
                )
            }

        X_tr_c = sm.add_constant(X_tr, has_constant="add")
        X_val_c = sm.add_constant(X_val, has_constant="add")
        # Guard against a sparse dummy column being constant/absent within
        # this particular fold's training partition, which could otherwise
        # misalign the fold's design matrix columns between fit and predict.
        X_val_c = X_val_c.reindex(columns=X_tr_c.columns, fill_value=0)

        try:
            fold_model = sm.OLS(y_tr, X_tr_c).fit()
            preds = fold_model.predict(X_val_c)

            r2 = r2_score(y_val, preds)
            rmse = mean_squared_error(y_val, preds) ** 0.5
            mae = mean_absolute_error(y_val, preds)
        except Exception as e:
            return {"error": f"Fold {fold_idx} failed: {str(e)}"}

        fold_r2.append(r2)
        fold_rmse.append(rmse)
        fold_mae.append(mae)
        fold_results.append({
            "fold": fold_idx,
            "n_train": len(X_tr),
            "n_val": len(X_val),
            "r2": safe_round(r2),
            "rmse": safe_round(rmse),
            "mae": safe_round(mae),
        })

    return {
        "k_folds": k,
        "fold_results": fold_results,
        "r2_mean": safe_round(float(np.mean(fold_r2))),
        "r2_std": safe_round(float(np.std(fold_r2))),
        "rmse_mean": safe_round(float(np.mean(fold_rmse))),
        "rmse_std": safe_round(float(np.std(fold_rmse))),
        "mae_mean": safe_round(float(np.mean(fold_mae))),
        "mae_std": safe_round(float(np.std(fold_mae))),
        "note": (
            "Supplementary robustness check, not a hyperparameter search — "
            "plain OLS has no regularization strength to tune. Compare "
            "r2_mean/r2_std here against the single-split test_r2 above: a "
            "large gap or a large std across folds suggests the single 80/20 "
            "split may not be representative of the model's typical "
            "out-of-sample performance."
        ),
    }


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

        # Guard against an underdetermined model: if there are as many or
        # more predictors (plus the intercept) than training rows, sm.OLS
        # will still "fit" but the result is degenerate/unreliable.
        n_params = X_train.shape[1] + 1  # +1 for the intercept
        if len(X_train) <= n_params:
            raise ValueError(
                f"Not enough training observations ({len(X_train)}) for the "
                f"number of parameters ({n_params}). Upload more rows, "
                f"reduce the number of independent/categorical variables, "
                f"or disable the train/test split for very small datasets."
            )

        X_train_c = sm.add_constant(X_train, has_constant="add")
        X_test_c = sm.add_constant(X_test, has_constant="add")

        model = sm.OLS(y_train, X_train_c).fit()
        predictions = model.predict(X_test_c)

        residuals = model.resid
        fitted_values = model.fittedvalues

        # Test-set (out-of-sample) predictive performance. Requires at
        # least 2 test points for r2_score to be meaningful — with only one
        # point, R² is either exactly 0 or an unstable/undefined value, so
        # we report it as None with the row count rather than a misleading
        # number.
        if len(X_test) >= 2:
            test_r2 = safe_round(r2_score(y_test, predictions))
            test_mse = safe_round(mean_squared_error(y_test, predictions))
            test_mae = safe_round(mean_absolute_error(y_test, predictions))
        else:
            test_r2 = None
            test_mse = None
            test_mae = None

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

        # ── Supplementary k-fold cross-validation (robustness check) ──
        # Uses the FULL dataset (X, y), not just the training split, since
        # this is an independent analysis re-partitioning the data k ways
        # rather than reusing the single 80/20 split above.
        try:
            cross_validation = run_kfold_cv(X, y, k=CV_FOLDS)
        except Exception as e:
            cross_validation = {"error": f"Cross-validation failed: {str(e)}"}

        # ── Build full payload and sanitize in one pass ──
        response_payload = sanitize({
            "success": True,
            "model": "OLS",
            "rows_used": len(X),
            "n_train": len(X_train),
            "n_test": len(X_test),

            # In-sample (training) fit statistics — this is what a plain
            # statsmodels/Stata/R OLS summary reports by default, and what
            # you should compare against when benchmarking coefficients,
            # standard errors, and model fit against another tool.
            "r2_score": safe_round(model.rsquared),
            "adj_r2": safe_round(model.rsquared_adj),
            "f_statistic": safe_round(model.fvalue),
            "f_pvalue": safe_round(model.f_pvalue),
            "aic": safe_round(model.aic),
            "bic": safe_round(model.bic),

            # Out-of-sample (held-out test set) predictive performance —
            # NOT directly comparable to a script that fits and scores on
            # the full dataset; only compare this against another pipeline
            # using the identical train_test_split (same test_size and
            # random_state).
            "test_r2": test_r2,
            "test_mse": test_mse,
            "test_mae": test_mae,

            "coefficients": {
                str(k): safe_round(v, 6) for k, v in model.params.items()
            },
            "standard_errors": standard_errors,
            "p_values": p_values,
            "robust_standard_errors_hc3": robust_se,
            "robust_p_values_hc3": robust_p_values,
            "diagnostics": diagnostics,

            # Supplementary robustness check — see run_kfold_cv() docstring.
            # NOT part of the primary reported metrics above; use this to
            # gauge whether test_r2/test_mse/test_mae are stable estimates.
            "cross_validation": cross_validation,
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