from statsmodels.tsa.stattools import adfuller
from statsmodels.tsa.arima.model import ARIMA
import pandas as pd

import numpy as np
import pandas as pd


def preprocess_exog(df, exog_cols):
    """
    Robust exogenous preprocessing:
    - Continuous variables stored as strings → numeric
    - Truly categorical variables → one-hot
    - Output guaranteed float matrix for SARIMAX
    """

    processed = []

    for col in exog_cols:
        series = df[col]

        # Try numeric conversion first
        numeric = pd.to_numeric(series, errors="coerce")

        # If conversion worked for most rows → continuous
        if numeric.notna().mean() > 0.8:
            processed.append(numeric.rename(col))
        else:
            # Truly categorical
            dummies = pd.get_dummies(series, prefix=col, drop_first=True)
            processed.append(dummies)

    exog_df = pd.concat(processed, axis=1)

    # Final safety cast
    exog_df = exog_df.astype(float)

    return exog_df


def compute_metrics(results, test_data, target_var, exog_test=None):
    forecast = results.forecast(
        steps=len(test_data),
        exog=exog_test
    )

    forecast = pd.Series(forecast).reset_index(drop=True)
    actual = test_data[target_var].reset_index(drop=True)

    mse = float(np.mean((actual - forecast) ** 2))
    rmse = float(np.sqrt(mse))

    return {
        "mse": round(mse, 3),
        "rmse": round(rmse, 3),
        "aic": round(results.aic, 3),
        "bic": round(results.bic, 3)
    }


def to_serializable(obj):
    if isinstance(obj, dict):
        return {k: to_serializable(v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [to_serializable(v) for v in obj]
    if isinstance(obj, np.generic):
        return obj.item()
    return obj

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

def make_lagged_features(series, lags=3):
    data = {}
    for i in range(1, lags + 1):
        data[f"lag_{i}"] = series.shift(i)
    return pd.DataFrame(data)
