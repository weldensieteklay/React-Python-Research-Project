from fastapi import Request, HTTPException
from sklearn.linear_model import LassoCV
import pandas as pd

from ..common.helper import (
    clean_input_data,
    preprocess_exog,
    compute_lasso_metrics,
    to_serializable,
    create_lag_features
)

async def predict_price_lasso(request: Request):
    try:
        payload = await request.json()

        raw_data = payload.get("data", [])
        date_col = payload.get("date_variable")
        target_col = payload.get("target_variable")
        exog_cols = payload.get("exogenous_variable", [])

        if not raw_data or not date_col or not target_col:
            raise HTTPException(status_code=400, detail="Missing required fields")

        # -------------------------------
        # Load and clean data
        # -------------------------------
        df = clean_input_data(raw_data)
        df[date_col] = pd.to_datetime(df[date_col])
        df[target_col] = pd.to_numeric(df[target_col], errors="coerce")
        df.sort_values(by=date_col, inplace=True)

        # -------------------------------
        # Create lag features
        # -------------------------------
        df = create_lag_features(df, target_col, num_lags=3)
        lag_cols = [col for col in df.columns if col.startswith(f"{target_col}_lag_")]

        # -------------------------------
        # Build feature matrix
        # -------------------------------
        X_parts = []

        if lag_cols:
            X_parts.append(df[lag_cols])

        if exog_cols:
            exog_df = preprocess_exog(df, exog_cols)
            X_parts.append(exog_df)

        if not X_parts:
            raise HTTPException(status_code=400, detail="No features found for model")

        X = pd.concat(X_parts, axis=1)

        # Drop NaNs from lagging
        valid_idx = X.dropna().index
        X = X.loc[valid_idx]
        y = df.loc[valid_idx, target_col]

        # -------------------------------
        # Train-test split (time series)
        # -------------------------------
        split_index = int(len(X) * 0.8)
        X_train, X_test = X.iloc[:split_index], X.iloc[split_index:]
        y_train, y_test = y.iloc[:split_index], y.iloc[split_index:]

        # -------------------------------
        # Lasso Model
        # -------------------------------
        lasso = LassoCV(cv=5, random_state=42)
        lasso.fit(X_train, y_train)

        # -------------------------------
        # Metrics
        # -------------------------------
        metrics = compute_lasso_metrics(lasso, X_test, y_test, X.columns)

        return to_serializable(metrics)

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=repr(e))
