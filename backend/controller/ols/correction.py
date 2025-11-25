import statsmodels.api as sm
from statsmodels.stats.stattools import durbin_watson

def run_glsar_correction(y, X):
    """
    Applies GLSAR correction when autocorrelation is detected.
    Returns corrected model and results.
    """
    X_const = sm.add_constant(X)
    glsar_model = sm.GLSAR(y, X_const, rho=1)
    glsar_results = glsar_model.iterative_fit(5)
    dw_stat_corrected = durbin_watson(glsar_results.resid)

    return {
        "coefficients": glsar_results.params.to_dict(),
        "r_squared": float(glsar_results.rsquared),
        "adjusted_r_squared": float(glsar_results.rsquared_adj),
        "durbin_watson": float(dw_stat_corrected),
        "summary": glsar_results.summary().as_text()
    }
