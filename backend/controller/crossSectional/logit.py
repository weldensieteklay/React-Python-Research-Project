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
    """
    try:
        df = pd.DataFrame({"y": y_true, "prob": y_prob})
        df["decile"] = pd.qcut(df["prob"], q=g, duplicates="drop")
        grouped    = df.groupby("decile", observed=True)
        observed_1 = grouped["y"].sum()
        observed_0 = grouped["y"].apply(lambda x: (x == 0).sum())
        expected_1 = grouped["prob"].sum()
        expected_0 = grouped["prob"].apply(lambda x: len(x) - x.sum())

        hl_stat = float(
            ((observed_1 - expected_1) ** 2 / expected_1.clip(lower=1e-10)).sum()
            + ((observed_0 - expected_0) ** 2 / expected_0.clip(lower=1e-10)).sum()
        )
        df_hl   = len(observed_1) - 2
        p_value = float(1 - stats.chi2.cdf(hl_stat, df=df_hl))

        return {
            "statistic":      safe_round(hl_stat),
            "p_value":        safe_round(p_value),
            "df":             df_hl,
            "interpretation": interpret_p(p_value),
            "conclusion": (
                "Model fits well (fail to reject H0)."
                if p_value >= 0.05
                else "Poor model fit — consider adding variables or interactions."
            ),
        }
    except Exception as e:
        return {"error": str(e)}


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

        # ── Fit Logit via GLM ──
        model = sm.GLM(
            y_train,
            X_train_c,
            family=sm.families.Binomial(link=sm.families.links.Logit()),
        ).fit(disp=False)

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
        marginal_effects = None
        try:
            me = model.get_margeff(at="mean")
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

        # ── Robust SEs (HC3) ──
        try:
            model_robust = model.get_robustcov_results(cov_type="HC3")
            robust_se    = {str(k): safe_round(v, 6) for k, v in zip(model.params.index, model_robust.bse)}
            robust_pvals = {str(k): safe_round(v, 6) for k, v in zip(model.params.index, model_robust.pvalues)}
        except Exception as e:
            robust_se    = {"error": str(e)}
            robust_pvals = {"error": str(e)}

        # ── Goodness of fit ──
        pseudo_r2 = safe_round(1 - (model.llf / model.llnull)) if model.llnull != 0 else None

        # ── Classification metrics ──
        classification = build_classification_metrics(
            y_test.values, y_pred_test, y_prob_test.values
        )

        # ── Diagnostics ──
        pearson_resid = model.resid_pearson
        diagnostics = {
            "multicollinearity":        test_multicollinearity(X_train),
            "normality_of_residuals":   test_normality_residuals(pearson_resid),
            "influential_observations": test_influential_observations(model, X_train_c),
            "hosmer_lemeshow":          test_hosmer_lemeshow(y_test.values, y_prob_test.values),
        }

        return JSONResponse(content=sanitize({
            "success":            True,
            "model":              "LOGIT",
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
            "deviance":           safe_round(model.deviance),
            "pearson_chi2":       safe_round(model.pearson_chi2),
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
            # Marginal effects
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