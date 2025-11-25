from statsmodels.tsa.stattools import adfuller
from statsmodels.tsa.arima.model import ARIMA
import pandas as pd

def is_valid_date(date_str):
    try:
        pd.to_datetime(date_str)
        return True
    except ValueError:
        return False

def test_stationarity(series):
    """Perform Augmented Dickey-Fuller test."""
    result = adfuller(series)

    return {
        'test_statistic': result[0],
        'p_value': result[1],
        'critical_values': result[4],
        'stationary': result[1] < 0.05
    }

def fit_arima_model(endog, exog=None):
    """Fit ARIMA model (with or without exogenous variables)."""
    stationarity = test_stationarity(endog)
    order = (3, 0, 0) if stationarity['stationary'] else (3, 1, 0)
    trend = 'c' if stationarity['stationary'] else None
    model = ARIMA(endog, order=order, trend=trend, exog=exog)
    results = model.fit()
    return results, stationarity

def extract_model_summary(results, target_var):
    """Extract coefficients, SE, and p-values."""
    summary_data = []
    params = results.params
    bse = results.bse
    pvals = results.pvalues

    for name in params.index:
        summary_data.append({
            'field_name': name if name != 'const' else 'constant',
            'mean': f"{params[name]:.3f}",
            'standard_error': f"{bse[name]:.3f}",
            'p_value': f"{pvals[name]:.3f}"
        })
    return summary_data
