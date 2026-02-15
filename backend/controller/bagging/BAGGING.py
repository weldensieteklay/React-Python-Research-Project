from fastapi import Request, HTTPException
import pandas as pd
from sklearn.ensemble import BaggingRegressor

from ..common.helper import (
    clean_input_data,
    preprocess_exog,
    create_lag_features,
    compute_bagging_metrics,
    to_serializable
)

async def predict_price_bagging(request: Request):
    try:
        # --------------------------
        # Parse JSON payload
        # --------------------------
        payload = await request.json()
        raw_data = payload.get("data", [])
        date_col = payload.get("date_variable")
        target_col = payload.get("target_variable")
        exog_cols = payload.get("exogenous_variable", [])

        if not raw_data or not date_col or not target_col:
            raise HTTPException(status_code=400, detail="Missing required fields")

        # --------------------------
        # Load & clean data
        # --------------------------
        df = clean_input_data(raw_data)
        df[date_col] = pd.to_datetime(df[date_col])
        df[target_col] = pd.to_numeric(df[target_col], errors="coerce")
        df.sort_values(by=date_col, inplace=True)

        # --------------------------
        # Generate lag features
        # --------------------------
        df = create_lag_features(df, target_col, num_lags=3)
        lag_cols = [c for c in df.columns if c.startswith(f"{target_col}_lag_")]

        # --------------------------
        # Build feature matrix
        # --------------------------
        if exog_cols:
            exog_df = preprocess_exog(df, exog_cols)
            X = pd.concat([exog_df, df[lag_cols]], axis=1)
        else:
            X = df[lag_cols]

        # Remove NaN rows created by lagging
        valid_rows = X.dropna().index
        X = X.loc[valid_rows]
        y = df.loc[valid_rows, target_col]

        # --------------------------
        # Time-series train/test split (80/20)
        # --------------------------
        split_index = int(len(X) * 0.8)
        X_train, X_test = X.iloc[:split_index], X.iloc[split_index:]
        y_train, y_test = y.iloc[:split_index], y.iloc[split_index:]

        # --------------------------
        # Bagging Regressor
        # --------------------------
        model = BaggingRegressor(
            n_estimators=300,
            max_samples=1.0,
            max_features=1.0,
            bootstrap=True,
            random_state=42
        )
        model.fit(X_train, y_train)

        # --------------------------
        # Compute metrics and return
        # --------------------------
        metrics = compute_bagging_metrics(model, X_test, y_test, X.columns)
        return to_serializable(metrics)

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
