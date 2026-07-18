from fastapi.responses import JSONResponse
from sklearn.model_selection import train_test_split
from sklearn.metrics import (
    accuracy_score, roc_auc_score, confusion_matrix,
    classification_report, log_loss, brier_score_loss,
)
import statsmodels.api as sm
from statsmodels.stats.outliers_influence import variance_inflation_factor
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


def compute_pearson_residuals(y, p):
    """
    Pearson residuals for a Bernoulli model: (y - p) / sqrt(p * (1-p)).
    Computed manually rather than relying on a model attribute, since
    resid_pearson is a GLM-family concept and its availability on
    sm.Logit's results object isn't guaranteed across versions.
    """
    p_clipped = np.clip(p, 1e-10, 1 - 1e-10)
    return (y - p_clipped) / np.sqrt(p_clipped * (1 - p_clipped))


def compute_deviance_and_pearson_chi2(y, p):
    """
    For ungrouped (individual-observation) binary data, the saturated
    log-likelihood is exactly 0 (each observation is fit perfectly by its
    own outcome, and 0*log(0) and 1*log(1) both evaluate to 0). So:
        deviance = -2 * (llf - llf_saturated) = -2 * llf
    computed directly here from y and predicted probabilities p, rather
    than assumed as a model attribute (deviance/pearson_chi2 are GLM
    concepts and may not exist identically on Logit's results object).
    """
    p_clipped = np.clip(p, 1e-10, 1 - 1e-10)
    llf = np.sum(y * np.log(p_clipped) + (1 - y) * np.log(1 - p_clipped))
    deviance = -2 * llf
    pearson_resid = compute_pearson_residuals(y, p)
    pearson_chi2 = float(np.sum(pearson_resid ** 2))
    return float(deviance), pearson_chi2


def get_convergence_flag(model):
    """
    Checks multiple possible locations for the optimizer's convergence
    status, since the attribute name/location has varied across
    statsmodels versions for discrete (MLE-based) models.
    """
    if hasattr(model, "converged"):
        return bool(model.converged)
    mle_retvals = getattr(model, "mle_retvals", None)
    if isinstance(mle_retvals, dict) and "converged" in mle_retvals:
        return bool(mle_retvals["converged"])
    return None  # unknown — don't assert convergence if we can't confirm it


# ─────────────────────────────────────────
# DIAGNOSTIC TESTS
# ─────────────────────────────────────────

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


def test_normality_residuals(residuals):
    """
    Normality of residuals is NOT an assumption of Logit.
    Reported for reference only.
    """
    results = {
        "note": (
            "Normality of residuals is NOT an assumption of the Logit model. "
            "These tests are provided for reference only."
        )
    }
    try:
        jb_stat, jb_p, jb_skew, jb_kurt = jarque_bera(residuals)
        results["jarque_bera"] = {
            "statistic": safe_round(jb_stat),
            "p_value":   safe_round(jb_p),
            "skewness":  safe_round(jb_skew),
            "kurtosis":  safe_round(jb_kurt),
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
            "p_value":   safe_round(sw_p),
        }
    except Exception as e:
        results["shapiro_wilk"] = {"error": str(e)}

    return results


def test_influential_observations(model, X_with_const):
    try:
        influence    = model.get_influence()
        cooks_d      = influence.cooks_distance[0]
        n            = len(cooks_d)
        threshold    = 4 / n
        influential_idx = np.where(cooks_d > threshold)[0].tolist()
        return {
            "threshold":          safe_round(threshold, 6),
            "n_influential":      len(influential_idx),
            "influential_indices": influential_idx[:20],
            "max_cooks_d":        safe_round(float(np.nanmax(cooks_d))),
            "conclusion": (
                f"{len(influential_idx)} influential observation(s) detected "
                f"(Cook's D > {round(threshold, 4)})."
                if influential_idx
                else "No influential observations detected."
            ),
        }
    except Exception as e:
        return {"error": str(e)}


def test_hosmer_lemeshow(y_true, y_prob, g=10):
    """
    Hosmer-Lemeshow goodness-of-fit test for binary models.
    H0: model fits well. p > 0.05 → good fit.

    NOTE: with many binary/dummy predictors, predicted probabilities are
    often tied across many rows, which can collapse far fewer than `g`
    distinct groups (pd.qcut's duplicates="drop"). If that leaves too few
    groups for a meaningful chi-square df, we report that explicitly
    instead of returning a nonsensical statistic.
    """
    try:
        df = pd.DataFrame({"y": y_true, "prob": y_prob})
        df["decile"] = pd.qcut(df["prob"], q=g, duplicates="drop")
        grouped    = df.groupby("decile", observed=True)
        observed_1 = grouped["y"].sum()
        observed_0 = grouped["y"].apply(lambda x: (x == 0).sum())
        expected_1 = grouped["prob"].sum()
        expected_0 = grouped["prob"].apply(lambda x: len(x) - x.sum())

        n_groups = len(observed_1)
        df_hl = n_groups - 2
        if df_hl <= 0:
            return {
                "error": (
                    f"Only {n_groups} distinct probability group(s) after binning — "
                    "insufficient for a meaningful Hosmer-Lemeshow test. This usually "
                    "happens when most predictors are binary/dummy variables, causing "
                    "many tied predicted probabilities."
                )
            }

        hl_stat = float(
            ((observed_1 - expected_1) ** 2 / expected_1.clip(lower=1e-10)).sum()
            + ((observed_0 - expected_0) ** 2 / expected_0.clip(lower=1e-10)).sum()
        )
        p_value = float(1 - stats.chi2.cdf(hl_stat, df=df_hl))

        return {
            "statistic":      safe_round(hl_stat),
            "p_value":        safe_round(p_value),
            "df":             df_hl,
            "n_groups":       n_groups,
            "interpretation": interpret_p(p_value),
            "conclusion": (
                "Model fits well (fail to reject H0)."
                if p_value >= 0.05
                else "Poor model fit — consider adding variables or interactions."
            ),
        }
    except Exception as e:
        return {"error": str(e)}


def test_separation_risk(params, std_errors, coef_threshold=10, se_threshold=100):
    """
    Flags coefficients that look like they may be suffering from
    (quasi-)complete separation: a coefficient pushed toward an
    extreme value with a correspondingly enormous standard error.
    This is a common failure mode for logit models with many sparse
    binary/dummy predictors (e.g., rare-category district or region
    dummies), and it can silently sit inside a 90+ variable coefficient
    dictionary unless explicitly flagged.
    """
    flagged = []
    for name, coef in params.items():
        if coef is None:
            continue
        se = std_errors.get(name)
        if abs(coef) > coef_threshold or (se is not None and se > se_threshold):
            flagged.append({
                "variable": name,
                "coefficient": coef,
                "standard_error": se,
            })
    return {
        "n_flagged": len(flagged),
        "flagged_variables": flagged,
        "conclusion": (
            f"{len(flagged)} variable(s) show signs of possible separation "
            "(extreme coefficient and/or standard error). Results for these "
            "variables should be interpreted with caution — consider Firth's "
            "penalized logistic regression or dropping/collapsing sparse "
            "categories."
            if flagged
            else "No obvious signs of separation detected."
        ),
    }


def build_classification_metrics(y_true, y_pred, y_prob):
    try:
        cm     = confusion_matrix(y_true, y_pred).tolist()
        report = classification_report(y_true, y_pred, output_dict=True)
        return {
            "accuracy":               safe_round(accuracy_score(y_true, y_pred)),
            "roc_auc":                safe_round(roc_auc_score(y_true, y_prob)),
            "log_loss":               safe_round(log_loss(y_true, y_prob)),
            "brier_score":            safe_round(brier_score_loss(y_true, y_prob)),
            "confusion_matrix":       cm,
            "classification_report":  sanitize(report),
        }
    except Exception as e:
        return {"error": str(e)}


# ─────────────────────────────────────────
# MAIN HANDLER
# ─────────────────────────────────────────

async def run_logit_prediction(request):
    """
    Logit (binary logistic regression) for a 0/1 dependent variable.

    Payload parameters:
      - data, dependent_variable, independent_variable  (required)
      - categorical_variable, id_column, outliers       (optional)
      - threshold: float in (0, 1)                      (default: 0.5)
    """
    try:
        payload = await request.json()

        raw_data         = payload.get("data", [])
        categorical_cols = payload.get("categorical_variable", [])
        dependent_col    = payload.get("dependent_variable")
        independent_cols = payload.get("independent_variable", [])
        id_col           = payload.get("id_column")
        remove_outliers  = payload.get("outliers", False)
        threshold        = float(payload.get("threshold", 0.5))

        # ── Validation ──
        if not raw_data:
            raise ValueError("No data provided")
        if not dependent_col:
            raise ValueError("Dependent variable is required")
        if not independent_cols:
            raise ValueError("Independent variables are required")
        if not (0 < threshold < 1):
            raise ValueError("threshold must be between 0 and 1")

        if isinstance(remove_outliers, str):
            remove_outliers = remove_outliers.strip().lower() in ("yes", "true", "1")

        # ── Prepare dataset ──
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

        # ── Binary check ──
        unique_vals = y.unique()
        if not set(unique_vals).issubset({0, 1}):
            raise ValueError(
                f"Dependent variable must be binary (0/1). "
                f"Found values: {sorted(unique_vals.tolist())}. "
                f"Please encode your target as 0 and 1 before submitting."
            )

        if len(X) < 5:
            raise ValueError("Dataset too small for Logit")

        # ── Class balance ──
        class_counts  = y.value_counts().to_dict()
        class_balance = {str(int(k)): int(v) for k, v in class_counts.items()}
        minority_pct  = safe_round(min(class_counts.values()) / len(y) * 100)
        imbalance_warning = (
            f"Class imbalance detected: minority class is {minority_pct}% of data. "
            "Consider resampling or adjusting the classification threshold."
            if minority_pct is not None and minority_pct < 20
            else None
        )

        # ── Train / test split (stratified to preserve class ratio) ──
        X_train, X_test, y_train, y_test = train_test_split(
            X, y, test_size=0.2, random_state=42, stratify=y
        )

        X_train_c = sm.add_constant(X_train, has_constant="add")
        X_test_c  = sm.add_constant(X_test,  has_constant="add")

        # ── Fit Logit directly (not via GLM) ──
        # sm.Logit is what researchers overwhelmingly call directly in
        # practice — it's mathematically identical to
        # GLM(Binomial, Logit link) and converges to the same MLE solution,
        # but using Logit itself maximizes equivalence with the literature
        # and with what a reviewer would type themselves.
        model = sm.Logit(y_train, X_train_c).fit(disp=False)
        converged = get_convergence_flag(model)

        y_prob_train = model.predict(X_train_c)
        y_prob_test  = model.predict(X_test_c)
        y_pred_test  = (y_prob_test >= threshold).astype(int)

        # ── Coefficients & inference ──
        params     = {str(k): safe_round(v, 6) for k, v in model.params.items()}
        std_errors = {str(k): safe_round(v, 6) for k, v in model.bse.items()}
        p_values   = {str(k): safe_round(v, 6) for k, v in model.pvalues.items()}

        conf_int = model.conf_int()
        confidence_intervals = {
            str(idx): {
                "lower": safe_round(row[0], 6),
                "upper": safe_round(row[1], 6),
            }
            for idx, row in conf_int.iterrows()
        }

        # ── Odds ratios (exp of coefficients) ──
        # OR > 1 → increases probability of outcome = 1
        # OR < 1 → decreases probability of outcome = 1
        odds_ratios = {
            str(k): safe_round(np.exp(v), 6)
            for k, v in model.params.items()
            if k != "const"
        }
        odds_ratio_ci = {
            str(idx): {
                "lower": safe_round(np.exp(row[0]), 6),
                "upper": safe_round(np.exp(row[1]), 6),
            }
            for idx, row in conf_int.iterrows()
            if idx != "const"
        }

        # ── Marginal effects at the mean (MEM) ──
        # dummy=True is essential here: with dummy=False (the default),
        # statsmodels computes the marginal effect for EVERY regressor as
        # the derivative of the logistic function at the mean — which is
        # only correct for continuous predictors. For a 0/1 dummy (which is
        # nearly every predictor in this model: electricity_1, urban_1, all
        # dist*_1 columns, etc.), the correct marginal effect is the
        # discrete change P(y=1 | d=1) - P(y=1 | d=0), holding other
        # covariates at their means. dummy=True tells statsmodels to detect
        # binary regressors and use that discrete-change formula instead.
        marginal_effects = None
        try:
            me = model.get_margeff(at="mean", dummy=True)
            marginal_effects = {
                str(k): {
                    "marginal_effect": safe_round(v, 6),
                    "std_error":       safe_round(se, 6),
                    "p_value":         safe_round(pv, 6),
                    "interpretation":  interpret_p(safe_round(pv, 6)),
                }
                for k, v, se, pv in zip(
                    me.summary_frame().index,
                    me.margeff,
                    me.margeff_se,
                    me.pvalues,
                )
            }
        except Exception as e:
            marginal_effects = {"error": str(e)}

        # ── Robust SEs ──
        # HC3 is a leverage-based small-sample correction specific to
        # linear (OLS/GLM) models and is not a standard robust covariance
        # type for MLE-based models like Logit. The standard "robust" SE
        # researchers use for logit is the basic White/sandwich estimator,
        # requested here via cov_type="HC0" at fit time (statsmodels'
        # documented mechanism for discrete-model robust covariance),
        # rather than a post-hoc get_robustcov_results(cov_type="HC3") call.
        try:
            model_robust = sm.Logit(y_train, X_train_c).fit(disp=False, cov_type="HC0")
            robust_se    = {str(k): safe_round(v, 6) for k, v in model_robust.bse.items()}
            robust_pvals = {str(k): safe_round(v, 6) for k, v in model_robust.pvalues.items()}
        except Exception as e:
            robust_se    = {"error": str(e)}
            robust_pvals = {"error": str(e)}

        # ── Goodness of fit ──
        # prsquared is Logit's built-in McFadden's pseudo-R^2 property —
        # using it directly rather than recomputing 1 - llf/llnull by hand.
        pseudo_r2 = safe_round(model.prsquared) if model.llnull != 0 else None

        # ── Classification metrics ──
        classification = build_classification_metrics(
            y_test.values, y_pred_test, y_prob_test.values
        )

        # ── Diagnostics ──
        # resid_pearson, deviance, and pearson_chi2 are GLM-family concepts;
        # computed manually here rather than assumed as attributes on
        # Logit's results object (see helper functions above).
        pearson_resid = compute_pearson_residuals(y_train.values, y_prob_train.values)
        deviance, pearson_chi2 = compute_deviance_and_pearson_chi2(y_train.values, y_prob_train.values)
        diagnostics = {
            "multicollinearity":        test_multicollinearity(X_train),
            "normality_of_residuals":   test_normality_residuals(pearson_resid),
            "influential_observations": test_influential_observations(model, X_train_c),
            "hosmer_lemeshow":          test_hosmer_lemeshow(y_test.values, y_prob_test.values),
            "separation_risk":          test_separation_risk(params, std_errors),
        }

        return JSONResponse(content=sanitize({
            "success":            True,
            "model":              "LOGIT",
            "converged":          converged,
            "rows_used":          len(X),
            "n_train":            len(y_train),
            "n_test":             len(y_test),
            "threshold":          threshold,
            "class_balance":      class_balance,
            "imbalance_warning":  imbalance_warning,
            # Fit statistics
            "log_likelihood":     safe_round(model.llf),
            "null_log_likelihood": safe_round(model.llnull),
            "pseudo_r2_mcfadden": pseudo_r2,
            "aic":                safe_round(model.aic),
            "bic":                safe_round(model.bic),
            "deviance":           safe_round(deviance),
            "pearson_chi2":       safe_round(pearson_chi2),
            # Coefficients (log-odds)
            "coefficients":           params,
            "standard_errors":        std_errors,
            "p_values":               p_values,
            "confidence_intervals_95": confidence_intervals,
            # Robust inference
            "robust_standard_errors": robust_se,
            "robust_p_values":        robust_pvals,
            # Odds ratios (exponentiated coefficients)
            "odds_ratios":            odds_ratios,
            "odds_ratio_ci_95":       odds_ratio_ci,
            # Marginal effects (discrete change for dummies, derivative for continuous)
            "marginal_effects_at_mean": marginal_effects,
            # Classification performance
            "classification":         classification,
            # Diagnostics
            "diagnostics":            diagnostics,
        }))

    except Exception as e:
        return JSONResponse(
            content={
                "success": False,
                "error":   "Logit model execution failed",
                "details": str(e),
            },
            status_code=500,
        )
