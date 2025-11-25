from flask import jsonify, request
import pandas as pd
from .preprocessing import clean_input_data, prepare_dataframe, detect_columns
from .model_utils import compute_metrics, to_serializable
from .helpers import extract_model_summary, fit_arima_model, test_stationarity

def predict_price():
    try:
        payload = request.get_json()

        # Extract params
        raw_data = payload.get('data', [])
        date_col = payload.get('date_variable')
        target_col = payload.get('target_variable')
        exog_cols = payload.get('exogenous_variable', [])

        if not raw_data or not date_col or not target_col:
            return jsonify({'error': 'Missing required fields (data, date_variable, target_variable)'}), 400

        # Clean & prepare dataframe
        df = clean_input_data(raw_data)
        df[date_col] = pd.to_datetime(df[date_col])
        df[target_col] = pd.to_numeric(df[target_col], errors='coerce')
        df.sort_values(by=date_col, inplace=True)

        # Handle exogenous variables
        exog_df = None
        if exog_cols:
            exog_df = df[exog_cols].copy()
            for col in exog_cols:
                # Binary categorical (1/0)
                if exog_df[col].nunique() <= 2:
                    exog_df[col] = pd.to_numeric(exog_df[col], errors='coerce')
                # Multi-class categorical (>2 unique)
                elif exog_df[col].dtype == object or exog_df[col].nunique() > 2:
                    exog_df = pd.get_dummies(exog_df, columns=[col], drop_first=True)
                # Continuous
                else:
                    exog_df[col] = pd.to_numeric(exog_df[col], errors='coerce')

        # Train/test split
        split_index = int(len(df) * 0.8)
        train, test = df.iloc[:split_index], df.iloc[split_index:]
        exog_train = exog_df.iloc[:split_index] if exog_df is not None else None
        exog_test = exog_df.iloc[split_index:] if exog_df is not None else None

        # Fit ARIMA
        results, stationarity = fit_arima_model(train[target_col], exog=exog_train)

        # Generate output
        summary = extract_model_summary(results, target_col)
        metrics = compute_metrics(results, test, target_col, exog_test=exog_test)
        response = {
            **metrics,
            'data': summary,
            'stationary': bool(stationarity['stationary']),
            'adfuller': round(stationarity['p_value'], 3)
        }

        return jsonify(to_serializable(response))

    except Exception as e:
        return jsonify({'error': repr(e)}), 500