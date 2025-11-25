import pandas as pd
from statsmodels.tsa.statespace.sarimax import SARIMAX

def run_sarimax_model(df, target_var, exog_vars, future_df):
    """
    Fits SARIMAX/ARIMA model depending on presence of exogenous variables,
    and returns fitted model details and forecasts.
    """
    try:
        # Ensure numeric and aligned
        if len(exog_vars) > 0:

            # Convert exogenous to numeric
            df[exog_vars] = df[exog_vars].apply(pd.to_numeric, errors='coerce')
            future_df[exog_vars] = future_df[exog_vars].apply(pd.to_numeric, errors='coerce')


            model = SARIMAX(
                df[target_var],
                exog=df[exog_vars],
                order=(1, 1, 1),
                seasonal_order=(0, 0, 0, 0),
                enforce_stationarity=False,
                enforce_invertibility=False
            )
            print('1111Fitting SARIMAX model with exogenous variables')

            results = model.fit(disp=False)
            print(results.summary(), 'sssssssss')

            forecast = results.get_forecast(
                steps=len(future_df),
                exog=future_df[exog_vars]
            )

        else:
            print('No exogenous vars — using plain ARIMA')
            model = SARIMAX(
                df[target_var],
                order=(1, 1, 1),
                seasonal_order=(0, 0, 0, 0),
                enforce_stationarity=False,
                enforce_invertibility=False
            )
            results = model.fit(disp=False)
            forecast = results.get_forecast(steps=len(future_df))

        future_df['forecast'] = forecast.predicted_mean

        return {
            "arima_applied": True,
            "coefficients": results.params.to_dict(),
            "aic": float(results.aic),
            "bic": float(results.bic),
            "forecast": future_df,
            "summary": results.summary().as_text()
        }

    except Exception as e:
        return {"error": str(e)}
