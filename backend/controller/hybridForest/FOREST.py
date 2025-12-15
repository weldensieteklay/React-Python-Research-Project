from flask import jsonify, request
from sklearn.ensemble import RandomForestRegressor
import statsmodels.api as sm
import pandas as pd

from ..common.helper import (
    clean_input_data,
    preprocess_exog,
    compute_rf_metrics,
    to_serializable,
    create_lag_features
)

def predict_price_hybrid_forest():
    try:
        payload = request.get_json()
        raw_data = payload.get('data', [])
        date_col = payload.get('date_variable')
        target_col = payload.get('target_variable')
        exog_cols = payload.get('exogenous_variable', [])

        if not raw_data or not date_col or not target_col:
            return jsonify({'error': 'Missing required fields'}), 400

        # -----------------------------
        # Load & clean
        # -----------------------------
        df = clean_input_data(raw_data)
        df[date_col] = pd.to_datetime(df[date_col])
        df[target_col] = pd.to_numeric(df[target_col], errors='coerce')
        df.sort_values(by=date_col, inplace=True)

        # -----------------------------
        # Lag features (always)
        # -----------------------------
        df = create_lag_features(df, target_col, num_lags=3)
        lag_cols = [c for c in df.columns if c.startswith(f"{target_col}_lag_")]

        # -----------------------------
        # Exogenous preprocessing
        # -----------------------------
        if exog_cols:
            exog_df = preprocess_exog(df, exog_cols)
        else:
            exog_df = pd.DataFrame(index=df.index)

        # -----------------------------
        # Structural (Econometric) Model
        # Uses ONLY lags + linear exog
        # -----------------------------
        X_struct = pd.concat([df[lag_cols], exog_df], axis=1)
        X_struct = sm.add_constant(X_struct)

        y = df[target_col]

        valid_idx = X_struct.dropna().index
        X_struct = X_struct.loc[valid_idx]
        y = y.loc[valid_idx]
        exog_df = exog_df.loc[valid_idx]

        split = int(len(X_struct) * 0.8)

        Xs_train, Xs_test = X_struct.iloc[:split], X_struct.iloc[split:]
        y_train, y_test = y.iloc[:split], y.iloc[split:]
        exog_train, exog_test = exog_df.iloc[:split], exog_df.iloc[split:]

        struct_model = sm.OLS(y_train, Xs_train).fit()

        y_struct_train = struct_model.predict(Xs_train)
        y_struct_test = struct_model.predict(Xs_test)

        # -----------------------------
        # Residuals for ML
        # -----------------------------
        residuals_train = y_train - y_struct_train

        # ML features = nonlinear signals only
        X_ml_train = exog_train
        X_ml_test = exog_test

        # -----------------------------
        # Random Forest on residuals
        # -----------------------------
        rf = RandomForestRegressor(
            n_estimators=300,
            random_state=42
        )

        rf.fit(X_ml_train, residuals_train)

        residual_preds = rf.predict(X_ml_test)

        # -----------------------------
        # Hybrid prediction
        # -----------------------------
        y_hybrid_pred = y_struct_test + residual_preds

        # -----------------------------
        # Metrics
        # -----------------------------
        rmse = float(((y_test - y_hybrid_pred) ** 2).mean() ** 0.5)

        response = {
            "model": "hybrid_structural_random_forest",
            "rmse": round(rmse, 3),

            # Structural regression output
            "data": [
                {
                    "field_name": name,
                    "mean": round(val, 4),
                    "standard_error": round(se, 4),
                    "p_value": round(p, 4)
                }
                for name, val, se, p in zip(
                    struct_model.params.index,
                    struct_model.params.values,
                    struct_model.bse.values,
                    struct_model.pvalues.values
                )
            ],

            # ML residual importance
            "residual_feature_importance": compute_rf_metrics(
                rf,
                X_ml_test,
                y_test - y_struct_test,
                X_ml_test.columns
            )["data"]
        }

        return jsonify(to_serializable(response))

    except Exception as e:
        return jsonify({'error': repr(e)}), 500
