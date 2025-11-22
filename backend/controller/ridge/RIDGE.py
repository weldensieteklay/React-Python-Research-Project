from flask import jsonify, request
from sklearn.linear_model import RidgeCV
import pandas as pd

from ..common.helper import (
    clean_input_data, preprocess_exog, compute_ridge_metrics,
    to_serializable, create_lag_features
)

def predict_price_ridge():
    try:
        payload = request.get_json()
        raw_data = payload.get('data', [])
        date_col = payload.get('date_variable')
        target_col = payload.get('target_variable')
        exog_cols = payload.get('exogenous_variable', [])

        if not raw_data or not date_col or not target_col:
            return jsonify({'error': 'Missing required fields'}), 400

        # Load and clean
        df = clean_input_data(raw_data)
        df[date_col] = pd.to_datetime(df[date_col])
        df[target_col] = pd.to_numeric(df[target_col], errors='coerce')
        df.sort_values(by=date_col, inplace=True)

        # ------------------------------------------
        # ALWAYS generate lag features (best practice)
        # ------------------------------------------
        df = create_lag_features(df, target_col, num_lags=3)

        # ------------------------------------------
        # Build feature matrix
        # ------------------------------------------
        lag_cols = [col for col in df.columns if col.startswith(f"{target_col}_lag_")]

        if exog_cols:
            exog_df = preprocess_exog(df, exog_cols)
            X = pd.concat([exog_df, df[lag_cols]], axis=1)
        else:
            X = df[lag_cols]

        # Remove rows with NaN from lag creation
        valid_rows = X.dropna().index
        X = X.loc[valid_rows]
        y = df.loc[valid_rows, target_col]

        # ------------------------------------------
        # Time-series train-test split (80/20)
        # ------------------------------------------
        split_index = int(len(X) * 0.8)
        X_train, X_test = X.iloc[:split_index], X.iloc[split_index:]
        y_train, y_test = y.iloc[:split_index], y.iloc[split_index:]

        # ------------------------------------------
        # Ridge with cross-validated alpha
        # ------------------------------------------
        alphas = [0.1, 1.0, 5.0, 10.0, 50.0]
        ridge = RidgeCV(alphas=alphas, cv=5)
        ridge.fit(X_train, y_train)

        # ------------------------------------------
        # Compute metrics and return
        # ------------------------------------------
        metrics = compute_ridge_metrics(ridge, X_test, y_test, X.columns)
        return jsonify(to_serializable(metrics))

    except Exception as e:
        return jsonify({'error': repr(e)}), 500
