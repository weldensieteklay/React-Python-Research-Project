import numpy as np
import pandas as pd
from statsmodels.tsa.statespace.sarimax import SARIMAX
from statsmodels.tsa.stattools import adfuller


def fit_arima_model(y, exog=None):
    model = SARIMAX(
        y,
        exog=exog,
        order=(1, 0, 1),
        enforce_stationarity=False,
        enforce_invertibility=False
    )

    results = model.fit(disp=False)

    adf_result = adfuller(y)
    stationarity = {
        "stationary": adf_result[1] < 0.05,
        "p_value": adf_result[1]
    }

    return results, stationarity

def to_serializable(obj):
    """Recursively convert numpy data types to native Python types."""
    if isinstance(obj, dict):
        return {k: to_serializable(v) for k, v in obj.items()}
    elif isinstance(obj, list):
        return [to_serializable(v) for v in obj]
    elif isinstance(obj, np.generic):
        return obj.item()
    else:
        return obj


def compute_metrics(results, test_data, target_var, exog_test=None):
    """Compute MSE, RMSE, AIC, and BIC safely with aligned indices."""
    forecast = results.forecast(steps=len(test_data), exog=exog_test)

    # Ensure both forecast and test have matching index positions
    forecast = pd.Series(forecast).reset_index(drop=True)
    actual = test_data[target_var].reset_index(drop=True)

    mse = float(np.mean((actual - forecast) ** 2))
    rmse = float(np.sqrt(mse))

    return {
        'mse': round(mse, 3),
        'rmse': round(rmse, 3),
        'aic': round(results.aic, 3),
        'bic': round(results.bic, 3)
    }




def fit_arima_model(y, exog=None):
    model = SARIMAX(
        y,
        exog=exog,
        order=(1, 0, 1),
        enforce_stationarity=False,
        enforce_invertibility=False
    )

    results = model.fit(disp=False)

    adf_result = adfuller(y)
    stationarity = {
        "stationary": adf_result[1] < 0.05,
        "p_value": adf_result[1]
    }

    return results, stationarity
