from flask import jsonify, request
from sklearn.ensemble import GradientBoostingRegressor
import pandas as pd

from ..common.helper import (
    clean_input_data, preprocess_exog, create_lag_features,
    compute_boosting_metrics, to_serializable
)

def predict_price_boosting():
    try:
        payload = request.get_json()
        raw_data = payload.get('data', [])
        date_col = payload.get('date_variable')
        target_col = payload.get('target_variable')
        exog_cols = payload.get('exogenous_variable', [])

        if not raw_data or not date_col or not target_col:
            return jsonify({"error": "Missing required fields"}), 400

        df = clean_input_data(raw_data)
        df[date_col] = pd.to_datetime(df[date_col])
        df[target_col] = pd.to_numeric(df[target_col], errors="coerce")
        df.sort_values(by=date_col, inplace=True)

        # Lag features
        df = create_lag_features(df, target_col, num_lags=3)
        lag_cols = [c for c in df.columns if c.startswith(f"{target_col}_lag_")]

        # Features: exog + lags
        if exog_cols:
            X = pd.concat([preprocess_exog(df, exog_cols), df[lag_cols]], axis=1)
        else:
            X = df[lag_cols]

        # Clean NaNs from lagging
        valid_rows = X.dropna().index
        X = X.loc[valid_rows]
        y = df.loc[valid_rows, target_col]

        # Time-series split
        split_index = int(len(X) * 0.8)
        X_train, X_test = X.iloc[:split_index], X.iloc[split_index:]
        y_train, y_test = y.iloc[:split_index], y.iloc[split_index:]

        # Gradient Boosting Model
        model = GradientBoostingRegressor(
            n_estimators=300,
            learning_rate=0.05,
            max_depth=3,
            subsample=1.0,
            random_state=42
        )

        model.fit(X_train, y_train)

        # Compute metrics
        metrics = compute_boosting_metrics(model, X_test, y_test, X.columns)
        return jsonify(to_serializable(metrics))

    except Exception as e:
        return jsonify({"error": repr(e)}), 500
