import numpy as np
import pandas as pd
from sklearn.linear_model import LinearRegression
from sklearn.metrics import r2_score
from datetime import timedelta

def run_ols_prediction(input_data):
    try:
        print("Received input data for OLS time series:", input_data.keys())

        # ---- 1. Extract & prepare ----
        df = pd.DataFrame(input_data['data'])
        date_col = input_data['date_variable']
        target_var = input_data['target_variable']
        exog_vars = input_data.get('exogenous_variable', [])

        df[date_col] = pd.to_datetime(df[date_col])
        df = df.sort_values(by=date_col)

        # ---- 2. Prepare features (X) and target (y) ----
        df = df.dropna(subset=[target_var] + exog_vars)

        # Convert date to numeric trend (days since first date)
        df['time_index'] = (df[date_col] - df[date_col].min()).dt.days

        # Exogenous + time trend
        feature_cols = ['time_index'] + exog_vars
        X = df[feature_cols].astype(float)
        y = df[target_var].astype(float)

        # ---- 3. Fit model ----
        model = LinearRegression()
        model.fit(X, y)

        # ---- 4. Predict existing data ----
        df['prediction'] = model.predict(X)

        # ---- 5. Forecast future period ----
        start_date = pd.to_datetime(input_data['start_date'])
        end_date = pd.to_datetime(input_data['end_date'])
        future_dates = pd.date_range(start=start_date, end=end_date, freq='D')

        future_df = pd.DataFrame({
            date_col: future_dates,
            'time_index': (future_dates - df[date_col].min()).days
        })

        # If exogenous vars exist, fill with last known value
        for col in exog_vars:
            future_df[col] = df[col].iloc[-1] if len(df[col]) > 0 else 0

        future_X = future_df[['time_index'] + exog_vars].astype(float)
        future_df['forecast'] = model.predict(future_X)

        # ---- 6. Return result ----
        result = {
            "coefficients": model.coef_.tolist(),
            "intercept": model.intercept_.item(),
            "r_squared": r2_score(y, model.predict(X)),
            "historical": df[[date_col, target_var, 'prediction']].to_dict(orient='records'),
            "forecast": future_df[[date_col, 'forecast']].to_dict(orient='records')
        }

        return result

    except Exception as e:
        return {"error": str(e)}
