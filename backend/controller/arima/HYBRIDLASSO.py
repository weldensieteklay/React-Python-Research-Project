from flask import jsonify, request
import pandas as pd
import numpy as np

from sklearn.linear_model import LassoCV
from sklearn.preprocessing import StandardScaler
from sklearn.pipeline import Pipeline

from statsmodels.tsa.statespace.sarimax import SARIMAX

from .preprocessing import clean_input_data
from .helpers import preprocess_exog, to_serializable


# --------------------------------------------------
# Helper: lagged features
# --------------------------------------------------
def make_lagged_features(series, lags=3):
    data = {}
    for i in range(1, lags + 1):
        data[f"lag_{i}"] = series.shift(i)
    return pd.DataFrame(data)


def predict_price_hybrid_lasso():
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
        exog_df = preprocess_exog(df, exog_cols) if exog_cols else None

        # --------------------------------------------------
        # Train / test split
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

        y_arima_train = sarimax_fit.fittedvalues.reset_index(drop=True)
        y_arima_test = sarimax_fit.forecast(
            steps=len(y_test),
            exog=exog_test
        ).reset_index(drop=True)

        y_train_reset = y_train.reset_index(drop=True)
        y_test_reset = y_test.reset_index(drop=True)

        # --------------------------------------------------
        # Residuals
        # --------------------------------------------------
        residuals_train = y_train_reset - y_arima_train

        # --------------------------------------------------
        # LASSO feature construction
        # --------------------------------------------------
        if exog_train is not None and not exog_train.empty:
            # Case 1: Use exogenous variables
            X_lasso_train = exog_train.reset_index(drop=True)
            X_lasso_test = exog_test.reset_index(drop=True)
            y_lasso = residuals_train
        else:
            # Case 2: Use lagged residuals
            lag_df = make_lagged_features(residuals_train, lags=3)

            valid_idx = lag_df.dropna().index

            X_lasso_train = lag_df.loc[valid_idx]
            y_lasso = residuals_train.loc[valid_idx]

            # Build test features from last residuals
            last_res = residuals_train.iloc[-3:]

            X_lasso_test = pd.DataFrame({
                "lag_1": [last_res.iloc[-1]],
                "lag_2": [last_res.iloc[-2]],
                "lag_3": [last_res.iloc[-3]],
            })

        # --------------------------------------------------
        # LASSO
        # --------------------------------------------------
        lasso_pipeline = Pipeline([
            ("scaler", StandardScaler()),
            ("lasso", LassoCV(
                cv=5,
                max_iter=10000,
                random_state=42
            ))
        ])

        lasso_pipeline.fit(X_lasso_train, y_lasso)

        resid_preds = lasso_pipeline.predict(X_lasso_test)

        # Expand prediction if single-step
        if len(resid_preds) == 1:
            resid_preds = np.repeat(resid_preds, len(y_test_reset))

        # --------------------------------------------------
        # Hybrid prediction
        # --------------------------------------------------
        y_hybrid = y_arima_test + resid_preds

        # --------------------------------------------------
        # Metrics
        # --------------------------------------------------
        mse = float(np.mean((y_test_reset - y_hybrid) ** 2))
        rmse = float(np.sqrt(mse))
        mae = float(np.mean(np.abs(y_test_reset - y_hybrid)))

        # --------------------------------------------------
        # LASSO coefficient summary
        # --------------------------------------------------
        lasso = lasso_pipeline.named_steps["lasso"]

        coef_summary = [
            {
                "field_name": name,
                "mean": round(float(coef), 4),
                "standard_error": "",
                "p_value": ""
            }
            for name, coef in zip(X_lasso_train.columns, lasso.coef_)
            if abs(coef) > 0
        ]

        return jsonify(to_serializable({
            "model": "sarimax_lasso_hybrid",
            "rmse": round(rmse, 3),
            "mae": round(mae, 3),
            "mse": round(mse, 3),
            "aic": round(sarimax_fit.aic, 3),
            "bic": round(sarimax_fit.bic, 3),
            "data": coef_summary
        }))

    except Exception as e:
        return jsonify({
            "error": "Hybrid SARIMAX + LASSO failed",
            "details": repr(e)
        }), 500
