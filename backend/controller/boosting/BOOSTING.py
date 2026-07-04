from fastapi import Request, HTTPException
import pandas as pd
from sklearn.ensemble import GradientBoostingRegressor

from ..common.helper import (
    clean_input_data,
    preprocess_exog,
    create_lag_features,
    compute_boosting_metrics,
    to_serializable
)

async def predict_price_boosting(request: Request):
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

        # Remove NaNs from lagging
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
        # Gradient Boosting Model
        # --------------------------
        model = GradientBoostingRegressor(
            n_estimators=300,
            learning_rate=0.05,
            max_depth=3,
            subsample=1.0,
            random_state=42
        )
        model.fit(X_train, y_train)

        # --------------------------
        # Compute metrics and return
        # --------------------------
        metrics = compute_boosting_metrics(model, X_test, y_test, X.columns)
        response = { "model": "BOOSTING", **metrics } 
        return to_serializable(response)

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
