from flask import jsonify, request
from sklearn.ensemble import RandomForestRegressor
from statsmodels.tsa.statespace.sarimax import SARIMAX
import pandas as pd
import numpy as np

from ..common.helper import (
    clean_input_data,
    preprocess_exog,
    compute_rf_metrics,
    to_serializable
)


def predict_price_hybrid_forest():
    try:
        payload = request.get_json(force=True)

        raw_data = payload.get("data", [])
        date_col = payload.get("date_variable")
        target_col = payload.get("target_variable")
        exog_cols = payload.get("exogenous_variable", [])

        # -----------------------------
        # Basic validation
        # -----------------------------
        if not raw_data or not date_col or not target_col:
            return jsonify({
                "error": "data, date_variable, and target_variable are required"
            }), 400

        if isinstance(exog_cols, str):
            exog_cols = [exog_cols]

        # -----------------------------
        # Load & clean
        # -----------------------------
        df = clean_input_data(raw_data)

        required_cols = [date_col, target_col] + exog_cols
        missing = [c for c in required_cols if c not in df.columns]
        if missing:
            return jsonify({
                "error": f"Missing columns in input data: {missing}"
            }), 400

        # -----------------------------
        # Type conversion (ANNUAL DATA)
        # -----------------------------
        df[date_col] = pd.to_datetime(df[date_col], format="%Y", errors="coerce")
        df[target_col] = pd.to_numeric(df[target_col], errors="coerce")

        for col in exog_cols:
            df[col] = pd.to_numeric(df[col], errors="coerce")

        df = df.dropna(subset=[date_col, target_col])
        df.sort_values(by=date_col, inplace=True)
        df.set_index(date_col, inplace=True)

        if len(df) < 12:
            return jsonify({
                "error": "Not enough observations for ARIMA modeling"
            }), 400

        # -----------------------------
        # Exogenous preprocessing
        # -----------------------------
        exog_df = (
            preprocess_exog(df, exog_cols)
            if exog_cols else
            pd.DataFrame(index=df.index)
        ).astype(float)

        # -----------------------------
        # Train / test split
        # -----------------------------
        split = int(len(df) * 0.8)

        y_train, y_test = df[target_col].iloc[:split], df[target_col].iloc[split:]
        exog_train, exog_test = exog_df.iloc[:split], exog_df.iloc[split:]

        # -----------------------------
        # ARIMA (SARIMAX) model
        # -----------------------------
        arima_model = SARIMAX(
            y_train,
            exog=exog_train if not exog_train.empty else None,
            order=(1, 0, 1),   # simple ARIMA for annual data
            enforce_stationarity=False,
            enforce_invertibility=False
        )

        arima_fit = arima_model.fit(disp=False)

        y_arima_train = arima_fit.fittedvalues
        y_arima_test = arima_fit.predict(
            start=y_test.index[0],
            end=y_test.index[-1],
            exog=exog_test if not exog_test.empty else None
        )

        # -----------------------------
        # Residual learning (Random Forest)
        # -----------------------------
        residuals_train = y_train - y_arima_train

        X_ml_train = exog_train.fillna(0)
        X_ml_test = exog_test.fillna(0)

        rf = RandomForestRegressor(
            n_estimators=300,
            min_samples_leaf=2,
            random_state=42,
            n_jobs=-1
        )

        rf.fit(X_ml_train, residuals_train)
        residual_preds = rf.predict(X_ml_test)

        # -----------------------------
        # Hybrid prediction
        # -----------------------------
        y_hybrid_pred = y_arima_test + residual_preds

        # -----------------------------
        # Metrics
        # -----------------------------
        rmse = float(np.sqrt(np.mean((y_test - y_hybrid_pred) ** 2)))

        response = {
            "model": "arima_random_forest_hybrid_annual",
            "rmse": round(rmse, 3),

            "arima_summary": arima_fit.summary().as_text(),

            "residual_feature_importance": (
                compute_rf_metrics(
                    rf,
                    X_ml_test,
                    y_test - y_arima_test,
                    X_ml_test.columns
                ).get("data", [])
                if not X_ml_test.empty else []
            )
        }

        return jsonify(to_serializable(response))

    except Exception as e:
        return jsonify({
            "error": "Model execution failed",
            "details": repr(e)
        }), 500
