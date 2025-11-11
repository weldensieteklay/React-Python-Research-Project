import pandas as pd
from statsmodels.stats.stattools import durbin_watson
from statsmodels.stats.diagnostic import het_breuschpagan
from statsmodels.stats.outliers_influence import variance_inflation_factor
from statsmodels.tsa.stattools import adfuller

def test_stationarity(series):
    adf_stat, adf_p, _, _, _, _ = adfuller(series)
    return {
        "ADF Statistic": float(adf_stat),
        "p_value": float(adf_p),
        "is_stationary": bool(adf_p < 0.05)
    }

def test_autocorrelation(residuals):
    dw_stat = durbin_watson(residuals)
    return {
        "durbin_watson": float(dw_stat),
        "autocorrelation_detected": bool(dw_stat < 1.5 or dw_stat > 2.5)
    }

def test_heteroskedasticity(residuals, exog):
    lm_stat, lm_pvalue, f_stat, f_pvalue = het_breuschpagan(residuals, exog)
    return {
        "LM p_value": float(lm_pvalue),
        "F p_value": float(f_pvalue),
        "is_heteroskedastic": bool(lm_pvalue < 0.05 or f_pvalue < 0.05)
    }

def compute_vif(X_const):
    vif_data = pd.DataFrame()
    vif_data["feature"] = X_const.columns
    vif_data["VIF"] = [
        variance_inflation_factor(X_const.values, i)
        for i in range(X_const.shape[1])
    ]
    return vif_data
