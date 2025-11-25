import pandas as pd
import statsmodels.api as sm
from .helpers import convert_numpy
from .diagnostics import (
    test_stationarity,
    test_autocorrelation,
    test_heteroskedasticity,
    compute_vif
)
from .correction import run_glsar_correction
from .arima_model import run_sarimax_model


def run_ols_prediction(input_data):
    try:
        # ---- 1. Extract and Prepare Data ----
        df = pd.DataFrame(input_data['data'])
        date_col = input_data['date_variable']
        target_var = input_data['target_variable']
        exog_vars = input_data.get('exogenous_variable', [])

        if isinstance(exog_vars, str):
            exog_vars = [exog_vars]

        df[date_col] = pd.to_datetime(df[date_col])
        df = df.sort_values(by=date_col).dropna(subset=[target_var] + exog_vars)
        df['time_index'] = (df[date_col] - df[date_col].min()).dt.days

        X = df[['time_index'] + exog_vars].astype(float)
        y = df[target_var].astype(float)
        X_const = sm.add_constant(X)
        ols_model = sm.OLS(y, X_const).fit()
        df['prediction'] = ols_model.predict(X_const)

        # ---- 2. Forecast ----
        start_date = pd.to_datetime(input_data['start_date'])
        end_date = pd.to_datetime(input_data['end_date'])
        future_dates = pd.date_range(start=start_date, end=end_date, freq='D')
        future_df = pd.DataFrame({
            date_col: future_dates,
            'time_index': (future_dates - df[date_col].min()).days
        })
        for col in exog_vars:
            future_df[col] = df[col].iloc[-1] if len(df[col]) > 0 else 0
        future_X = sm.add_constant(future_df[['time_index'] + exog_vars].astype(float))
        future_X = future_X.reindex(columns=X_const.columns, fill_value=0)
        future_df['forecast'] = ols_model.predict(future_X)

        # ---- 3. Diagnostics ----
        stationarity = test_stationarity(df[target_var])
        auto = test_autocorrelation(ols_model.resid)
        hetero = test_heteroskedasticity(ols_model.resid, ols_model.model.exog)
        vif = compute_vif(X_const)

        # ---- 4. Handle Autocorrelation ----
        if auto["autocorrelation_detected"]:
            corrected = run_glsar_correction(y, X)
        else:
            corrected = {
                "coefficients": ols_model.params.to_dict(),
                "r_squared": float(ols_model.rsquared),
                "adjusted_r_squared": float(ols_model.rsquared_adj),
                "durbin_watson": float(auto["durbin_watson"]),
                "summary": ols_model.summary().as_text()
            }

        # ---- 5. Handle Non-Stationarity ----
        if not stationarity["is_stationary"]:
            print("⚠ Non-stationarity detected — switching to ARIMA/SARIMAX...")
            arima_result = run_sarimax_model(df, target_var, exog_vars, future_df)

            if "error" not in arima_result:
                corrected.update({
                    "arima_applied": True,
                    "coefficients": arima_result["coefficients"],
                    "aic": arima_result["aic"],
                    "bic": arima_result["bic"],
                    "summary": arima_result["summary"]
                })
                future_df = arima_result["forecast"]
            else:
                corrected["arima_applied"] = False
                corrected["error"] = arima_result["error"]
        else:
            corrected["arima_applied"] = False

        # ---- 6. Combine Results ----
        result = {
            "autocorrelation_detected": auto["autocorrelation_detected"],
            "arima_applied": corrected.get("arima_applied", False),
            "coefficients": corrected["coefficients"],
            "r_squared": corrected.get("r_squared"),
            "adjusted_r_squared": corrected.get("adjusted_r_squared"),
            "durbin_watson": corrected.get("durbin_watson"),
            "aic": corrected.get("aic"),
            "bic": corrected.get("bic"),
            "stationarity_test": stationarity,
            "heteroskedasticity_test": hetero,
            "vif": vif.to_dict(orient='records'),
            "historical": df[[date_col, target_var, 'prediction']].to_dict(orient='records'),
            "forecast": future_df[[date_col, 'forecast']].to_dict(orient='records'),
            "summary": corrected["summary"]
        }

        return convert_numpy(result)

    except Exception as e:
        return {"error": str(e)}
