from flask import jsonify, request
import pandas as pd
import numpy as np

from sklearn.ensemble import RandomForestRegressor
from statsmodels.tsa.statespace.sarimax import SARIMAX

from .preprocessing import clean_input_data
from .helpers import preprocess_exog, to_serializable


# --------------------------------------------------
# Helper: create lagged features
# --------------------------------------------------
def make_lagged_features(series, lags=3):
    data = {}
    for i in range(1, lags + 1):
        data[f"lag_{i}"] = series.shift(i)
    return pd.DataFrame(data)


def predict_price_hybrid_forest():
    try:
        payload = request.get_json(force=True)

        raw_data = payload.get("data", [])
        date_col = payload.get("date_variable")
        target_col = payload.get("target_variable")
        exog_cols = payload.get("exogenous_variable", [])

        if not raw_data or not date_col or not target_col:
            return jsonify({
                "error": "data, date_variable, and target_variable are required"
            }), 400

        # --------------------------------------------------
        # Load & clean
        # --------------------------------------------------
        df = clean_input_data(raw_data)

        df[date_col] = pd.to_datetime(df[date_col], errors="coerce")
        df[target_col] = pd.to_numeric(df[target_col], errors="coerce")

        for col in exog_cols:
            df[col] = pd.to_numeric(df[col], errors="coerce")

        df = df.dropna(subset=[date_col, target_col] + exog_cols)

        df.sort_values(by=date_col, inplace=True)
        df.set_index(date_col, inplace=True)

        if len(df) < 30:
            return jsonify({"error": "Not enough observations"}), 400

        # --------------------------------------------------
        # Exogenous preprocessing (optional)
        # --------------------------------------------------
        exog_df = (
            preprocess_exog(df, exog_cols)
            if exog_cols else None
        )

        # --------------------------------------------------
        # Train / test split (time-aware)
        # --------------------------------------------------
        split = int(len(df) * 0.8)

        y_train = df[target_col].iloc[:split]
        y_test = df[target_col].iloc[split:]

        exog_train = exog_df.iloc[:split] if exog_df is not None else None
        exog_test = exog_df.iloc[split:] if exog_df is not None else None

        # --------------------------------------------------
        # SARIMAX
        # --------------------------------------------------
        sarimax = SARIMAX(
            y_train,
            exog=exog_train,
            order=(1, 0, 1),
            enforce_stationarity=False,
            enforce_invertibility=False
        )

        sarimax_fit = sarimax.fit(disp=False)

        # Fitted & forecast values (reset index to avoid alignment bugs)
        y_arima_train = sarimax_fit.fittedvalues.reset_index(drop=True)
        y_arima_test = sarimax_fit.forecast(
            steps=len(y_test),
            exog=exog_test
        ).reset_index(drop=True)

        y_train_reset = y_train.reset_index(drop=True)
        y_test_reset = y_test.reset_index(drop=True)

        # --------------------------------------------------
        # Residual learning (Random Forest)
        # --------------------------------------------------
        residuals_train = y_train_reset - y_arima_train

        if exog_train is not None and not exog_train.empty:
            # Case 1: Exogenous variables exist
            X_rf_train = exog_train.reset_index(drop=True)
            X_rf_test = exog_test.reset_index(drop=True)
        else:
            # Case 2: No exogenous → use lagged residuals
            lag_df = make_lagged_features(residuals_train, lags=3)

            valid_idx = lag_df.dropna().index

            X_rf_train = lag_df.loc[valid_idx]
            residuals_train = residuals_train.loc[valid_idx]

            # Use last residuals for test prediction
            last_res = residuals_train.iloc[-3:]

            X_rf_test = pd.DataFrame({
                "lag_1": [last_res.iloc[-1]],
                "lag_2": [last_res.iloc[-2]],
                "lag_3": [last_res.iloc[-3]],
            })

        rf = RandomForestRegressor(
            n_estimators=500,
            min_samples_leaf=2,
            random_state=42,
            n_jobs=-1
        )

        rf.fit(X_rf_train, residuals_train)

        residual_preds = rf.predict(X_rf_test)

        # Repeat prediction across horizon if needed
        if len(residual_preds) == 1:
            residual_preds = np.repeat(residual_preds, len(y_test_reset))

        # --------------------------------------------------
        # Hybrid prediction
        # --------------------------------------------------
        y_hybrid = y_arima_test + residual_preds

        # --------------------------------------------------
        # Metrics
        # --------------------------------------------------
        mse = float(np.mean((y_test_reset - y_hybrid) ** 2))
        rmse = float(np.sqrt(mse))
        mae = float(np.mean(np.abs(y_test_reset - y_hybrid)))

        # --------------------------------------------------
        # Feature importance
        # --------------------------------------------------
        importance = [
            {
                "field_name": name,
                "importance": round(float(val), 4),
                "standard_error": "",
                "p_value": ""
            }
            for name, val in zip(X_rf_train.columns, rf.feature_importances_)
        ]

        response = {
            "model": "sarimax_random_forest_hybrid",
            "rmse": round(rmse, 3),
            "mae": round(mae, 3),
            "mse": round(mse, 3),
            "aic": round(sarimax_fit.aic, 3),
            "bic": round(sarimax_fit.bic, 3),
            "data": importance,
            "arima_summary": sarimax_fit.summary().as_text()
        }

        return jsonify(to_serializable(response))

    except Exception as e:
        return jsonify({
            "error": "Hybrid SARIMAX + Random Forest failed",
            "details": repr(e)
        }), 500
