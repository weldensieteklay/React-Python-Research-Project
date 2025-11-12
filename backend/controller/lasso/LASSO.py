from flask import jsonify, request
import pandas as pd
import numpy as np
from sklearn.linear_model import LassoCV
from .common.helpers import preprocess_exog, compute_lasso_metrics, clean_input_data, to_serializable



def predict_price_lasso():
    try:
        payload = request.get_json()

        # Extract params
        raw_data = payload.get('data', [])
        date_col = payload.get('date_variable')
        target_col = payload.get('target_variable')
        exog_cols = payload.get('exogenous_variable', [])

        if not raw_data or not date_col or not target_col:
            return jsonify({'error': 'Missing required fields (data, date_variable, target_variable)'}), 400

        # Clean and prepare dataframe
        df = clean_input_data(raw_data)
        df[date_col] = pd.to_datetime(df[date_col])
        df[target_col] = pd.to_numeric(df[target_col], errors='coerce')
        df.sort_values(by=date_col, inplace=True)

        # Handle exogenous variables
        if not exog_cols:
            return jsonify({'error': 'LASSO requires at least one exogenous variable (feature)'}), 400

        X = preprocess_exog(df, exog_cols)
        y = df[target_col]

        # Split train/test
        split_index = int(len(df) * 0.8)
        X_train, X_test = X.iloc[:split_index], X.iloc[split_index:]
        y_train, y_test = y.iloc[:split_index], y.iloc[split_index:]

        # Fit LASSO with cross-validation
        lasso = LassoCV(cv=5, random_state=42)
        lasso.fit(X_train, y_train)

        # Compute metrics & results
        metrics = compute_lasso_metrics(lasso, X_test, y_test, X.columns)
        return jsonify(to_serializable(metrics))

    except Exception as e:
        return jsonify({'error': repr(e)}), 500
