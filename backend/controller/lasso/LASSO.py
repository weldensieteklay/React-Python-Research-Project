from flask import jsonify, request
from sklearn.linear_model import LassoCV
import pandas as pd

from ..common.helper import (
    clean_input_data, preprocess_exog, compute_lasso_metrics,
    to_serializable, create_lag_features
)

def predict_price_lasso():
    try:
        payload = request.get_json()
        raw_data = payload.get('data', [])
        date_col = payload.get('date_variable')
        target_col = payload.get('target_variable')
        exog_cols = payload.get('exogenous_variable', [])

        if not raw_data or not date_col or not target_col:
            return jsonify({'error': 'Missing required fields'}), 400

        # -------------------------------
        # Load and clean data
        # -------------------------------
        df = clean_input_data(raw_data)
        df[date_col] = pd.to_datetime(df[date_col])
        df[target_col] = pd.to_numeric(df[target_col], errors='coerce')
        df.sort_values(by=date_col, inplace=True)

        # -------------------------------
        # ALWAYS create lag features (time series best practice)
        # -------------------------------
        df = create_lag_features(df, target_col, num_lags=3)
        lag_cols = [col for col in df.columns if col.startswith(f"{target_col}_lag_")]

        # -------------------------------
        # Build full feature matrix
        # -------------------------------
        X_parts = []

        # Lags are always useful
        if lag_cols:
            X_parts.append(df[lag_cols])

        # If exogenous vars exist, include them
        if exog_cols:
            exog_df = preprocess_exog(df, exog_cols)
            X_parts.append(exog_df)

        # Combine features
        if not X_parts:
            return jsonify({'error': 'No features found for model'}), 400

        X = pd.concat(X_parts, axis=1)

        # Drop rows created with NaNs from lagging
        valid_idx = X.dropna().index
        X = X.loc[valid_idx]
        y = df.loc[valid_idx, target_col]

        # -------------------------------
        # Time-series train-test split
        # -------------------------------
        split_index = int(len(X) * 0.8)
        X_train, X_test = X.iloc[:split_index], X.iloc[split_index:]
        y_train, y_test = y.iloc[:split_index], y.iloc[split_index:]

        # -------------------------------
        # Lasso Model with Cross Validation
        # -------------------------------
        lasso = LassoCV(cv=5, random_state=42)
        lasso.fit(X_train, y_train)

        # -------------------------------
        # Metrics + response
        # -------------------------------
        metrics = compute_lasso_metrics(lasso, X_test, y_test, X.columns)

        return jsonify(to_serializable(metrics))

    except Exception as e:
        return jsonify({'error': repr(e)}), 500
