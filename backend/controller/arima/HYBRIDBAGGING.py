from flask import jsonify, request
import pandas as pd
import numpy as np

from sklearn.ensemble import BaggingRegressor
from sklearn.tree import DecisionTreeRegressor
from statsmodels.tsa.statespace.sarimax import SARIMAX

from .preprocessing import clean_input_data
from .helpers import preprocess_exog, to_serializable


# --------------------------------------------------
# Helper: create lagged residual features
# --------------------------------------------------
def make_lagged_features(series, lags=3):
    return pd.DataFrame({
        f"lag_{i}": series.shift(i)
        for i in range(1, lags + 1)
    })


def predict_price_hybrid_bagging():
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
        # Optional exogenous preprocessing
        # --------------------------------------------------
        exog_df = preprocess_exog(df, exog_cols) if exog_cols else None

        # --------------------------------------------------
        # Train / test split (time-aware)
        # --------------------------------------------------
        split = int(len(df) * 0.8)

        y_train = df[target_col].iloc[:split].reset_index(drop=True)
        y_test = df[target_col].iloc[split:].reset_index(drop=True)

        exog_train = exog_df.iloc[:split].reset_index(drop=True) if exog_df is not None else None
        exog_test = exog_df.iloc[split:].reset_index(drop=True) if exog_df is not None else None

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

        y_arima_train = sarimax_fit.fittedvalues.reset_index(drop=True)
        y_arima_test = sarimax_fit.forecast(
            steps=len(y_test),
            exog=exog_test
        ).reset_index(drop=True)

        # --------------------------------------------------
        # Residuals
        # --------------------------------------------------
        residuals_train = y_train - y_arima_train

        # --------------------------------------------------
        # Bagging feature matrix
        # --------------------------------------------------
        if exog_train is not None and not exog_train.empty:
            X_train = exog_train
            X_test = exog_test
            y_bag = residuals_train
        else:
            lag_df = make_lagged_features(residuals_train, lags=3)
            valid_idx = lag_df.dropna().index

            X_train = lag_df.loc[valid_idx]
            y_bag = residuals_train.loc[valid_idx]

            last_res = residuals_train.iloc[-3:]
            X_test = pd.DataFrame({
                "lag_1": [last_res.iloc[-1]],
                "lag_2": [last_res.iloc[-2]],
                "lag_3": [last_res.iloc[-3]]
            })

        # --------------------------------------------------
        # Bagging Regressor
        # --------------------------------------------------
        bagging = BaggingRegressor(
            estimator=DecisionTreeRegressor(
                max_depth=3,
                min_samples_leaf=5
            ),
            n_estimators=300,
            bootstrap=True,
            random_state=42,
            n_jobs=-1
        )

        bagging.fit(X_train, y_bag)

        resid_preds = bagging.predict(X_test)

        if len(resid_preds) == 1:
            resid_preds = np.repeat(resid_preds, len(y_test))

        # --------------------------------------------------
        # Hybrid forecast
        # --------------------------------------------------
        y_hybrid = y_arima_test + resid_preds

        # --------------------------------------------------
        # Metrics
        # --------------------------------------------------
        mse = float(np.mean((y_test - y_hybrid) ** 2))
        rmse = float(np.sqrt(mse))
        mae = float(np.mean(np.abs(y_test - y_hybrid)))

        # --------------------------------------------------
        # Permutation-based importance (Bagging has none)
        # --------------------------------------------------
        importance = [
            {
                "field_name": name,
                "importance": None,
                "mean": None,
                "standard_error": "",
                "p_value": ""
            }
            for name in X_train.columns
        ]

        return jsonify(to_serializable({
            "model": "sarimax_bagging_hybrid",
            "rmse": round(rmse, 3),
            "mae": round(mae, 3),
            "mse": round(mse, 3),
            "aic": round(sarimax_fit.aic, 3),
            "bic": round(sarimax_fit.bic, 3),
            "data": importance
        }))

    except Exception as e:
        return jsonify({
            "error": "Hybrid SARIMAX + Bagging failed",
            "details": repr(e)
        }), 500
